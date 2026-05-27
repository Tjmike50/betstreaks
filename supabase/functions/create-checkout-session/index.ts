import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

type PlanKey = "monthly" | "yearly" | "lifetime" | "all_apps_lifetime";

interface PlanConfig {
  envVar: string;
  mode: "subscription" | "payment";
  product: "betstreaks" | "all_apps";
  label: string;
}

const PLAN_CONFIG: Record<PlanKey, PlanConfig> = {
  monthly: {
    envVar: "STRIPE_PRICE_BETSTREAKS_MONTHLY_1750",
    mode: "subscription",
    product: "betstreaks",
    label: "Premium Monthly",
  },
  yearly: {
    envVar: "STRIPE_PRICE_BETSTREAKS_YEARLY_180",
    mode: "subscription",
    product: "betstreaks",
    label: "Premium Yearly",
  },
  lifetime: {
    envVar: "STRIPE_PRICE_BETSTREAKS_LIFETIME_480",
    mode: "payment",
    product: "betstreaks",
    label: "BetStreaks Lifetime",
  },
  all_apps_lifetime: {
    envVar: "STRIPE_PRICE_ALL_APPS_LIFETIME_2750",
    mode: "payment",
    product: "all_apps",
    label: "All Apps Lifetime Pass",
  },
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("No authorization header");
    }

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      {
        global: { headers: { Authorization: authHeader } },
        auth: { persistSession: false },
      }
    );

    const {
      data: { user },
      error: userError,
    } = await supabaseClient.auth.getUser();

    if (userError || !user) {
      console.error("Auth error:", userError);
      throw new Error("User not authenticated");
    }

    const body = await req.json().catch(() => ({}));
    const plan = body?.plan as PlanKey | undefined;
    const allowPromoCodes = body?.allowPromoCodes === true;

    if (!plan || !(plan in PLAN_CONFIG)) {
      throw new Error(
        `Invalid or missing plan. Expected one of: ${Object.keys(PLAN_CONFIG).join(", ")}`
      );
    }

    const config = PLAN_CONFIG[plan];
    const priceId = Deno.env.get(config.envVar) ?? "";
    if (!priceId || !priceId.startsWith("price_")) {
      console.error(`Missing or invalid Stripe price env var: ${config.envVar}`);
      throw new Error(`Pricing configuration missing for plan: ${plan}`);
    }

    console.log(`Creating ${config.mode} checkout for plan=${plan} user=${user.id}`);

    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") ?? "", {
      apiVersion: "2023-10-16",
    });

    // Look up / create Stripe customer
    const { data: existingCustomer } = await supabaseAdmin
      .from("stripe_customers")
      .select("stripe_customer_id")
      .eq("user_id", user.id)
      .single();

    let stripeCustomerId = existingCustomer?.stripe_customer_id;

    if (!stripeCustomerId && user.email) {
      const existingStripeCustomers = await stripe.customers.list({
        email: user.email,
        limit: 1,
      });
      if (existingStripeCustomers.data.length > 0) {
        stripeCustomerId = existingStripeCustomers.data[0].id;
        await supabaseAdmin.from("stripe_customers").upsert(
          { user_id: user.id, stripe_customer_id: stripeCustomerId },
          { onConflict: "user_id" }
        );
      }
    }

    if (!stripeCustomerId) {
      const newCustomer = await stripe.customers.create({
        email: user.email,
        metadata: { user_id: user.id },
      });
      stripeCustomerId = newCustomer.id;
      await supabaseAdmin.from("stripe_customers").upsert(
        { user_id: user.id, stripe_customer_id: stripeCustomerId },
        { onConflict: "user_id" }
      );
    }

    // For subscription plans, block double-subscribing
    if (config.mode === "subscription") {
      const subscriptions = await stripe.subscriptions.list({
        customer: stripeCustomerId,
        status: "active",
        limit: 1,
      });
      if (subscriptions.data.length > 0) {
        throw new Error("User already has an active subscription");
      }
    }

    const origin = req.headers.get("origin") || "https://betstreaks.lovable.app";

    const sessionParams: Record<string, unknown> = {
      customer: stripeCustomerId,
      line_items: [{ price: priceId, quantity: 1 }],
      mode: config.mode,
      success_url: `${origin}/premium?success=1`,
      cancel_url: `${origin}/premium?canceled=1`,
      metadata: {
        user_id: user.id,
        plan,
        product: config.product,
      },
    };

    if (config.mode === "subscription") {
      sessionParams.subscription_data = {
        metadata: {
          user_id: user.id,
          plan,
          product: config.product,
        },
      };
    } else {
      // One-time payment (lifetime). Capture user_id + plan on the PaymentIntent too,
      // so the webhook can grant entitlement from either object.
      sessionParams.payment_intent_data = {
        metadata: {
          user_id: user.id,
          plan,
          product: config.product,
        },
      };
    }

    if (allowPromoCodes) {
      sessionParams.allow_promotion_codes = true;
    }

    const session = await stripe.checkout.sessions.create(sessionParams);

    return new Response(JSON.stringify({ url: session.url }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    console.error("Error creating checkout session:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      }
    );
  }
});
