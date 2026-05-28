import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

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

  const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  console.log("[create-portal-session] env check", {
    hasStripeSecretKey: Boolean(stripeSecretKey),
    hasSupabaseUrl: Boolean(supabaseUrl),
    hasServiceRoleKey: Boolean(supabaseServiceRoleKey),
  });

  if (!stripeSecretKey || !supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
    console.error("[create-portal-session] Missing required env vars");
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
      console.error("[create-portal-session] auth error", userError);
      return jsonOk({ error: "Not authenticated.", code: "no_auth" });
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { persistSession: false },
    });

    const { data: customerData } = await supabaseAdmin
      .from("stripe_customers")
      .select("stripe_customer_id")
      .eq("user_id", user.id)
      .maybeSingle();

    const stripeCustomerId = customerData?.stripe_customer_id ?? null;

    console.log("[create-portal-session] user lookup", {
      userId: user.id,
      hasStripeCustomerId: Boolean(stripeCustomerId),
    });

    if (!stripeCustomerId) {
      return jsonOk({
        error: "Premium access is active, but there is no subscription to manage.",
        code: "no_customer",
      });
    }

    const stripe = new Stripe(stripeSecretKey, { apiVersion: "2023-10-16" });

    // Confirm the customer has at least one subscription (active or canceled);
    // pure lifetime customers have none and shouldn't be sent to the portal.
    const subs = await stripe.subscriptions.list({
      customer: stripeCustomerId,
      status: "all",
      limit: 1,
    });

    if (subs.data.length === 0) {
      console.log("[create-portal-session] customer has no subscriptions", {
        userId: user.id,
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
