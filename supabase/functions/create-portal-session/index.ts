import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  loadBetstreaksAccount,
  loadLegacyAccount,
  selectPortalAccount,
  type StripeAccountId,
} from "../_shared/stripeAccounts.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Always return 200 + structured payload so the client can render a specific
// message instead of seeing "non-2xx status code". Real errors still log.
function jsonOk(payload: Record<string, unknown>) {
  return new Response(JSON.stringify(payload), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status: 200,
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const env = (key: string) => Deno.env.get(key);

  const supabaseUrl = env("SUPABASE_URL") ?? "";
  const supabaseAnonKey = env("SUPABASE_ANON_KEY") ?? "";
  const supabaseServiceRoleKey = env("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  const legacyAccount = loadLegacyAccount(env);
  const betstreaksAccount = loadBetstreaksAccount(env);

  console.log("[create-portal-session] env check", {
    hasLegacyAccount: Boolean(legacyAccount),
    hasBetstreaksAccount: Boolean(betstreaksAccount),
    hasSupabaseUrl: Boolean(supabaseUrl),
    hasServiceRoleKey: Boolean(supabaseServiceRoleKey),
  });

  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
    console.error("[create-portal-session] Missing required Supabase env vars");
    return jsonOk({
      error: "Billing portal is not configured. Please contact support.",
      code: "config_missing",
    });
  }

  if (!legacyAccount && !betstreaksAccount) {
    console.error("[create-portal-session] No Stripe account configured");
    return jsonOk({
      error: "Billing portal is not configured. Please contact support.",
      code: "config_missing",
    });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return jsonOk({ error: "Not authenticated.", code: "no_auth" });
  }

  try {
    const supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });

    const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
    if (userError || !user) {
      console.error("[create-portal-session] auth error", userError?.message);
      return jsonOk({ error: "Not authenticated.", code: "no_auth" });
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { persistSession: false },
    });

    // ── Gather subscription evidence from both accounts ──
    const [legacySubs, newSubs] = await Promise.all([
      supabaseAdmin
        .from("stripe_subscriptions")
        .select("status")
        .eq("user_id", user.id),
      supabaseAdmin
        .from("stripe_account_subscriptions")
        .select("status, stripe_account")
        .eq("user_id", user.id),
    ]);

    const rows: Array<{ account: StripeAccountId; status: string | null }> = [
      ...(legacySubs.data ?? []).map((r) => ({
        account: "legacy" as StripeAccountId,
        status: r.status as string | null,
      })),
      ...(newSubs.data ?? []).map((r) => ({
        account: (r.stripe_account as StripeAccountId) ?? "betstreaks",
        status: r.status as string | null,
      })),
    ];

    const targetAccountId = selectPortalAccount(rows);

    if (!targetAccountId) {
      console.log("[create-portal-session] no subscription rows for user", {
        userId: user.id,
      });
      return jsonOk({
        error: "Lifetime access active. No subscription to manage.",
        code: "no_subscription",
      });
    }

    const account = targetAccountId === "legacy" ? legacyAccount : betstreaksAccount;
    if (!account) {
      console.error("[create-portal-session] account not configured", {
        targetAccountId,
      });
      return jsonOk({
        error: "Billing portal is not configured. Please contact support.",
        code: "config_missing",
      });
    }

    // ── Customer id for that account ──
    let stripeCustomerId: string | null = null;
    if (targetAccountId === "legacy") {
      const { data } = await supabaseAdmin
        .from("stripe_customers")
        .select("stripe_customer_id")
        .eq("user_id", user.id)
        .maybeSingle();
      stripeCustomerId = data?.stripe_customer_id ?? null;
    } else {
      const { data } = await supabaseAdmin
        .from("stripe_account_customers")
        .select("stripe_customer_id")
        .eq("user_id", user.id)
        .eq("stripe_account", targetAccountId)
        .maybeSingle();
      stripeCustomerId = data?.stripe_customer_id ?? null;
    }

    console.log("[create-portal-session] user lookup", {
      userId: user.id,
      account: targetAccountId,
      hasStripeCustomerId: Boolean(stripeCustomerId),
    });

    if (!stripeCustomerId) {
      return jsonOk({
        error: "Premium access is active, but there is no subscription to manage.",
        code: "no_customer",
      });
    }

    const stripe = new Stripe(account.secretKey, { apiVersion: "2023-10-16" });

    // Confirm the customer really exists in THIS account; a cross-account id
    // would otherwise surface as a raw Stripe error.
    const subs = await stripe.subscriptions
      .list({ customer: stripeCustomerId, status: "all", limit: 1 })
      .catch((err: unknown) => {
        console.error("[create-portal-session] subscription lookup failed", {
          account: targetAccountId,
          message: err instanceof Error ? err.message : String(err),
        });
        return null;
      });

    if (!subs) {
      return jsonOk({
        error: "Could not reach your billing account. Please try again later.",
        code: "account_mismatch",
      });
    }

    if (subs.data.length === 0) {
      console.log("[create-portal-session] customer has no subscriptions", {
        userId: user.id,
        account: targetAccountId,
      });
      return jsonOk({
        error: "Lifetime access active. No subscription to manage.",
        code: "no_subscription",
      });
    }

    const origin = req.headers.get("origin") || "https://betstreaks.lovable.app";

    const portalSession = await stripe.billingPortal.sessions.create({
      customer: stripeCustomerId,
      return_url: `${origin}/premium`,
    });

    console.log("[create-portal-session] portal session created", {
      userId: user.id,
      account: targetAccountId,
      sessionId: portalSession.id,
    });

    return jsonOk({ url: portalSession.url });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[create-portal-session] portal creation failed", { message });
    return jsonOk({
      error: "Could not open billing portal. Please try again later.",
      code: "stripe_error",
    });
  }
});
