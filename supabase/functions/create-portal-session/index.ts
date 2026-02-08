import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Create Supabase client with user's auth token
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("No authorization header");
    }

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "",
      {
        global: { headers: { Authorization: authHeader } },
        auth: { persistSession: false },
      }
    );

    // Get authenticated user
    const {
      data: { user },
      error: userError,
    } = await supabaseClient.auth.getUser();

    if (userError || !user) {
      console.error("Auth error:", userError);
      throw new Error("User not authenticated");
    }

    console.log("Authenticated user:", user.id);

    // Create Supabase admin client for DB operations
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    // Get Stripe customer ID from database
    const { data: customerData, error: customerError } = await supabaseAdmin
      .from("stripe_customers")
      .select("stripe_customer_id")
      .eq("user_id", user.id)
      .single();

    if (customerError || !customerData?.stripe_customer_id) {
      console.error("Customer lookup error:", customerError);
      throw new Error("No Stripe customer found for this user");
    }

    console.log("Found Stripe customer:", customerData.stripe_customer_id);

    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") ?? "", {
      apiVersion: "2023-10-16",
    });

    // Get the origin for redirect URL
    const origin = req.headers.get("origin") || "https://betstreaks.lovable.app";

    // Create Customer Portal session
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: customerData.stripe_customer_id,
      return_url: `${origin}/premium`,
    });

    console.log("Created portal session:", portalSession.id);

    return new Response(JSON.stringify({ url: portalSession.url }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    console.error("Error creating portal session:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      }
    );
  }
});
