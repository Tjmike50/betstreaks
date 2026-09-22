import { validWeekCount, WEEKLY_PRICE_CENTS } from "../_shared/weeklyPass.ts";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  PLAN_LABELS,
  PLAN_MODES,
  PLAN_PRODUCTS,
  priceForPlan,
  selectCheckoutAccount,
  TEST_CUSTOMER_SCOPE,
  type EnvReader,
  type PlanKey,
} from "../_shared/stripeAccounts.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── Temporary non-sensitive diagnostics (booleans only, never values) ──
interface CheckoutDiagnostics {
  stage: string;
  reachedCheckoutCreate: boolean;
  testModeSelected: boolean | null;
  testSecretKeyPresent: boolean | null;
  testWeeklyPricePresent: boolean | null;
  selectedAccount: string | null;
  priceIdCompatible: boolean | null;
  stripeError: { type?: string; code?: string } | null;
}

function newDiagnostics(): CheckoutDiagnostics {
  return {
    stage: "init",
    reachedCheckoutCreate: false,
    testModeSelected: null,
    testSecretKeyPresent: null,
    testWeeklyPricePresent: null,
    selectedAccount: null,
    priceIdCompatible: null,
    stripeError: null,
  };
}

function jsonError(message: string, code: string, status = 400, diag?: CheckoutDiagnostics) {
  return new Response(JSON.stringify({ error: message, code, diagnostics: diag ?? null }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });
}

function extractStripeError(error: unknown): CheckoutDiagnostics["stripeError"] {
  if (error && typeof error === "object" && (error as { type?: unknown }).type) {
    const e = error as { type?: string; code?: string };
    return {
      // Raw Stripe errors (especially authentication errors) can contain keys.
      type: ["StripeInvalidRequestError", "StripeAuthenticationError", "StripePermissionError",
        "StripeRateLimitError", "StripeAPIError", "StripeConnectionError", "StripeCardError"].includes(e.type ?? "")
        ? e.type : undefined,
      code: ["resource_missing", "api_key_expired", "parameter_missing", "parameter_invalid_integer",
        "parameter_invalid_empty", "parameter_unknown", "rate_limit"].includes(e.code ?? "")
        ? e.code : undefined,
    };
  }
  return null;
}

export async function handleCheckoutRequest(req: Request, dependencies: {
  env?: EnvReader;
  createClient?: typeof createClient;
  createStripe?: (key: string) => Stripe;
} = {}): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const diag = newDiagnostics();

  try {
    const env = dependencies.env ?? ((key: string) => Deno.env.get(key));
    const makeClient = dependencies.createClient ?? createClient;

    // Populate presence-only diagnostics (booleans, never values).
    diag.testSecretKeyPresent = !!env("STRIPE_TEST_SECRET_KEY")?.trim();
    diag.testWeeklyPricePresent = !!env("STRIPE_TEST_PRICE_WEEKLY_PASS")?.trim();

    diag.stage = "auth";
    const supabaseAdmin = makeClient(
      env("SUPABASE_URL") ?? "",
      env("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } },
    );

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonError("No authorization header", "no_auth", 400, diag);
    }

    const supabaseClient = makeClient(
      env("SUPABASE_URL") ?? "",
      env("SUPABASE_ANON_KEY") ?? "",
      {
        global: { headers: { Authorization: authHeader } },
        auth: { persistSession: false },
      },
    );

    const {
      data: { user },
      error: userError,
    } = await supabaseClient.auth.getUser();

    if (userError || !user) {
      console.error("[create-checkout-session] authentication failed");
      return jsonError("User not authenticated", "no_auth", 401, diag);
    }

    diag.stage = "body_validation";
    const body = await req.json().catch(() => ({}));
    const plan = body?.plan as PlanKey | undefined;
    const allowPromoCodes = body?.allowPromoCodes === true;

    if (!plan || !Object.prototype.hasOwnProperty.call(PLAN_MODES, plan)) {
      return jsonError(
        `Invalid or missing plan. Expected one of: ${Object.keys(PLAN_MODES).join(", ")}`,
        "invalid_plan",
        400,
        diag,
      );
    }

    const weeks = plan === "weekly_pass" ? body?.weeks : 1;
    if (plan === "weekly_pass" && !validWeekCount(weeks)) {
      return jsonError("Choose a whole number of weeks from 1 to 520.", "invalid_weeks", 400, diag);
    }

    // ── Which Stripe account handles this new checkout? ──
    diag.stage = "account_selection";
    const { account, diagnostics } = selectCheckoutAccount(env, plan);
    diag.testModeSelected = diagnostics?.testMode === true;
    diag.selectedAccount = account?.id ?? null;
    console.log("[create-checkout-session] account selection", { plan, ...diagnostics });

    if (!account) {
      console.error("[create-checkout-session] no usable Stripe account configured");
      return jsonError(
        diagnostics.testModeRequested
          ? "Stripe test configuration is missing or invalid. Live checkout is disabled while test mode is requested."
          : "Checkout is temporarily unavailable. Please try again shortly.",
        diagnostics.testModeRequested ? "test_config_invalid" : "config_missing",
        diagnostics.testModeRequested ? 503 : 400,
        diag,
      );
    }

    if (plan === "weekly_pass" && account.id !== "betstreaks") {
      return jsonError("Weekly passes are temporarily unavailable.", "weekly_unavailable", 400, diag);
    }

    const priceId = priceForPlan(account, plan);
    if (!priceId) {
      console.error("[create-checkout-session] missing price for plan", {
        plan,
        account: account.id,
      });
      return jsonError(`Pricing configuration missing for plan: ${plan}`, "price_missing", 400, diag);
    }

    const mode = PLAN_MODES[plan];
    const product = PLAN_PRODUCTS[plan];
    const { customersTable } = account;
    const isTest = account.customerScope === TEST_CUSTOMER_SCOPE;

    const stripe = dependencies.createStripe?.(account.secretKey) ??
      new Stripe(account.secretKey, { apiVersion: "2023-10-16" });

    // Price/account compatibility check: retrieves the price object using the
    // selected account's key. Confirms the price exists and its expected mode
    // matches the plan, without exposing any credential material.
    if (plan === "weekly_pass" || isTest) {
      diag.stage = "price_verify";
      const price = await stripe.prices.retrieve(priceId);
      diag.priceIdCompatible = price.active &&
        (!isTest || price.livemode === false) &&
        price.type === (mode === "payment" ? "one_time" : "recurring") &&
        (plan !== "weekly_pass" || (price.currency === "usd" && price.unit_amount === WEEKLY_PRICE_CENTS));
      if (!diag.priceIdCompatible) {
        diag.stage = "price_mismatch";
        return jsonError(
          plan === "weekly_pass" ? "Weekly pricing is temporarily unavailable." : "Test pricing is invalid for this plan.",
          plan === "weekly_pass" ? "weekly_price_mismatch" : "test_price_mismatch", 400, diag,
        );
      }
    } else {
      diag.priceIdCompatible = true;
    }

    // ── Duplicate-subscription guard across BOTH accounts ──
    diag.stage = "duplicate_guard";
    if (mode === "subscription" && !isTest) {
      const [{ data: legacyActive }, { data: newActive }] = await Promise.all([
        supabaseAdmin
          .from("stripe_subscriptions")
          .select("stripe_subscription_id")
          .eq("user_id", user.id)
          .in("status", ["active", "trialing"])
          .limit(1),
        supabaseAdmin
          .from("stripe_account_subscriptions")
          .select("stripe_subscription_id")
          .eq("stripe_account", "betstreaks")
          .eq("user_id", user.id)
          .in("status", ["active", "trialing"])
          .limit(1),
      ]);

      const alreadySubscribed =
        (legacyActive?.length ?? 0) > 0 || (newActive?.length ?? 0) > 0;

      if (alreadySubscribed) {
        console.log("[create-checkout-session] blocked duplicate subscription", {
          userId: user.id,
        });
        return jsonError(
          "You already have an active subscription. Manage it from your account page.",
          "already_subscribed",
          400,
          diag,
        );
      }
    }

    // ── Customer lookup / creation, scoped to the selected account ──
    diag.stage = "customer_lookup";
    let stripeCustomerId: string | null = null;

    if (account.id === "legacy") {
      const { data, error } = await supabaseAdmin
        .from("stripe_customers")
        .select("stripe_customer_id")
        .eq("user_id", user.id)
        .maybeSingle();
      if (error) throw new Error("Customer lookup failed");
      stripeCustomerId = data?.stripe_customer_id ?? null;
    } else {
      const { data, error } = await supabaseAdmin
        .from(customersTable)
        .select("stripe_customer_id")
        .eq("user_id", user.id)
        .eq("stripe_account", account.customerScope)
        .maybeSingle();
      if (error) throw new Error("Customer lookup failed");
      stripeCustomerId = data?.stripe_customer_id ?? null;
    }

    async function rememberCustomer(customerId: string) {
      if (account!.id === "legacy") {
        const { error } = await supabaseAdmin
          .from("stripe_customers")
          .upsert(
            { user_id: user!.id, stripe_customer_id: customerId },
            { onConflict: "user_id" },
          );
        if (error) throw new Error("Customer persistence failed");
      } else {
        const { error } = await supabaseAdmin.from(customersTable).upsert(
          {
            user_id: user!.id,
            stripe_account: account!.customerScope,
            stripe_customer_id: customerId,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id,stripe_account" },
        );
        if (error) throw new Error("Customer persistence failed");
      }
    }

    if (!stripeCustomerId && user.email) {
      const found = await stripe.customers.list({ email: user.email, limit: 1 });
      if (found.data.length > 0) {
        stripeCustomerId = found.data[0].id;
        await rememberCustomer(found.data[0].id);
      }
    }

    if (!stripeCustomerId) {
      const created = await stripe.customers.create({
        email: user.email,
        metadata: { user_id: user.id, stripe_account: account.customerScope },
      });
      stripeCustomerId = created.id;
      await rememberCustomer(created.id);
    }

    // Second guard directly against Stripe for the selected account.
    if (mode === "subscription") {
      const subs = await stripe.subscriptions.list({
        customer: stripeCustomerId,
        status: "active",
        limit: 1,
      });
      if (subs.data.length > 0) {
        return jsonError(
          "You already have an active subscription. Manage it from your account page.",
          "already_subscribed",
          400,
          diag,
        );
      }
    }

    diag.stage = "checkout_create";
    diag.reachedCheckoutCreate = true;
    const origin = req.headers.get("origin") || "https://betstreaks.lovable.app";

    const metadata = {
      user_id: user.id,
      plan,
      product,
      stripe_account: account.customerScope,
      ...(plan === "weekly_pass" ? { weeks: String(weeks) } : {}),
    };

    const sessionParams: Record<string, unknown> = {
      customer: stripeCustomerId,
      line_items: [{ price: priceId, quantity: weeks }],
      mode,
      success_url: `${origin}/premium?success=1${plan === "weekly_pass" ? "&weekly_session={CHECKOUT_SESSION_ID}" : ""}`,
      cancel_url: `${origin}/premium?canceled=1`,
      metadata,
    };

    if (mode === "subscription") {
      sessionParams.subscription_data = { metadata };
    } else {
      sessionParams.payment_intent_data = { metadata };
    }

    if (allowPromoCodes && plan !== "weekly_pass") sessionParams.allow_promotion_codes = true;

    const session = await stripe.checkout.sessions.create(sessionParams);
    if (isTest && (session.livemode !== false || !session.id.startsWith("cs_test_"))) {
      return jsonError("Stripe test session verification failed.", "test_session_mismatch", 502, diag);
    }

    console.log("[create-checkout-session] session created", {
      userId: user.id,
      plan,
      label: PLAN_LABELS[plan],
      mode,
      account: account.id,
      testMode: isTest,
    });

    return new Response(JSON.stringify({ url: session.url }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    diag.stripeError = extractStripeError(error);
    if (diag.stage === "checkout_create") diag.reachedCheckoutCreate = true;
    console.error("Error creating checkout session:", {
      stage: diag.stage,
      stripeError: diag.stripeError,
      testModeSelected: diag.testModeSelected,
      selectedAccount: diag.selectedAccount,
    });
    return jsonError(
      "Could not create checkout. Please try again or contact support.",
      "stripe_error",
      400,
      diag,
    );
  }
}
