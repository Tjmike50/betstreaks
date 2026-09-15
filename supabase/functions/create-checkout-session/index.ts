import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  PLAN_LABELS,
  PLAN_MODES,
  PLAN_PRODUCTS,
  priceForPlan,
  selectCheckoutAccount,
  tablesForAccount,
  type PlanKey,
} from "../_shared/stripeAccounts.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function jsonError(message: string, code: string, status = 400) {
  return new Response(JSON.stringify({ error: message, code }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const env = (key: string) => Deno.env.get(key);

    const supabaseAdmin = createClient(
      env("SUPABASE_URL") ?? "",
      env("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } },
    );

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonError("No authorization header", "no_auth");
    }

    const supabaseClient = createClient(
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
      console.error("Auth error:", userError?.message);
      return jsonError("User not authenticated", "no_auth", 401);
    }

    const body = await req.json().catch(() => ({}));
    const plan = body?.plan as PlanKey | undefined;
    const allowPromoCodes = body?.allowPromoCodes === true;

    if (!plan || !(plan in PLAN_MODES)) {
      return jsonError(
        `Invalid or missing plan. Expected one of: ${Object.keys(PLAN_MODES).join(", ")}`,
        "invalid_plan",
      );
    }

    // ── Which Stripe account handles this new checkout? ──
    const { account, diagnostics } = selectCheckoutAccount(env);
    console.log("[create-checkout-session] account selection", { plan, ...diagnostics });

    if (!account) {
      console.error("[create-checkout-session] no usable Stripe account configured");
      return jsonError(
        "Checkout is temporarily unavailable. Please try again shortly.",
        "config_missing",
      );
    }

    const priceId = priceForPlan(account, plan);
    if (!priceId) {
      console.error("[create-checkout-session] missing price for plan", {
        plan,
        account: account.id,
      });
      return jsonError(`Pricing configuration missing for plan: ${plan}`, "price_missing");
    }

    const mode = PLAN_MODES[plan];
    const product = PLAN_PRODUCTS[plan];
    const { customersTable, subscriptionsTable } = tablesForAccount(account.id);

    const stripe = new Stripe(account.secretKey, { apiVersion: "2023-10-16" });

    // ── Duplicate-subscription guard across BOTH accounts ──
    if (mode === "subscription") {
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
        );
      }
    }

    // ── Customer lookup / creation, scoped to the selected account ──
    let stripeCustomerId: string | null = null;

    if (account.id === "legacy") {
      const { data } = await supabaseAdmin
        .from("stripe_customers")
        .select("stripe_customer_id")
        .eq("user_id", user.id)
        .maybeSingle();
      stripeCustomerId = data?.stripe_customer_id ?? null;
    } else {
      const { data } = await supabaseAdmin
        .from(customersTable)
        .select("stripe_customer_id")
        .eq("user_id", user.id)
        .eq("stripe_account", account.id)
        .maybeSingle();
      stripeCustomerId = data?.stripe_customer_id ?? null;
    }

    async function rememberCustomer(customerId: string) {
      if (account!.id === "legacy") {
        await supabaseAdmin
          .from("stripe_customers")
          .upsert(
            { user_id: user!.id, stripe_customer_id: customerId },
            { onConflict: "user_id" },
          );
      } else {
        await supabaseAdmin.from(customersTable).upsert(
          {
            user_id: user!.id,
            stripe_account: account!.id,
            stripe_customer_id: customerId,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id,stripe_account" },
        );
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
        metadata: { user_id: user.id, stripe_account: account.id },
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
        );
      }
    }

    const origin = req.headers.get("origin") || "https://betstreaks.lovable.app";

    const metadata = {
      user_id: user.id,
      plan,
      product,
      stripe_account: account.id,
    };

    const sessionParams: Record<string, unknown> = {
      customer: stripeCustomerId,
      line_items: [{ price: priceId, quantity: 1 }],
      mode,
      success_url: `${origin}/premium?success=1`,
      cancel_url: `${origin}/premium?canceled=1`,
      metadata,
    };

    if (mode === "subscription") {
      sessionParams.subscription_data = { metadata };
    } else {
      sessionParams.payment_intent_data = { metadata };
    }

    if (allowPromoCodes) sessionParams.allow_promotion_codes = true;

    const session = await stripe.checkout.sessions.create(sessionParams);

    console.log("[create-checkout-session] session created", {
      userId: user.id,
      plan,
      label: PLAN_LABELS[plan],
      mode,
      account: account.id,
      sessionId: session.id,
    });

    return new Response(JSON.stringify({ url: session.url }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    console.error("Error creating checkout session:", error);
    return jsonError(
      error instanceof Error ? error.message : "Unknown error",
      "stripe_error",
    );
  }
});
