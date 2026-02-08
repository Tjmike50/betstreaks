import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, stripe-signature",
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") ?? "", {
    apiVersion: "2023-10-16",
  });

  // Create Supabase admin client (use service role for writes)
  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } }
  );

  try {
    // Get the signature from headers
    const signature = req.headers.get("stripe-signature");
    if (!signature) {
      console.error("No stripe-signature header");
      return new Response("No signature", { status: 400 });
    }

    // Get raw body for signature verification
    const body = await req.text();

    // Verify the webhook signature
    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(
        body,
        signature,
        Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? ""
      );
    } catch (err) {
      console.error("Webhook signature verification failed:", err);
      return new Response(`Webhook signature verification failed`, { status: 400 });
    }

    console.log("Received webhook event:", event.type, event.id);

    // Helper function to update premium status
    async function updatePremiumStatus(userId: string, isPremium: boolean) {
      console.log(`Updating premium status for user ${userId} to ${isPremium}`);
      const { error } = await supabaseAdmin.from("user_flags").upsert(
        {
          user_id: userId,
          is_premium: isPremium,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      );
      if (error) {
        console.error("Error updating user_flags:", error);
        throw error;
      }
    }

    // Helper function to upsert subscription record
    async function upsertSubscription(
      userId: string,
      subscription: Stripe.Subscription
    ) {
      console.log(`Upserting subscription ${subscription.id} for user ${userId}`);
      const { error } = await supabaseAdmin.from("stripe_subscriptions").upsert(
        {
          user_id: userId,
          stripe_subscription_id: subscription.id,
          status: subscription.status,
          price_id: subscription.items.data[0]?.price?.id ?? null,
          current_period_end: new Date(
            subscription.current_period_end * 1000
          ).toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "stripe_subscription_id" }
      );
      if (error) {
        console.error("Error upserting stripe_subscriptions:", error);
        throw error;
      }
    }

    // Helper to get user_id from subscription or customer metadata
    async function getUserIdFromSubscription(
      subscription: Stripe.Subscription
    ): Promise<string | null> {
      // First check subscription metadata
      if (subscription.metadata?.user_id) {
        return subscription.metadata.user_id;
      }

      // Then check customer
      const customerId =
        typeof subscription.customer === "string"
          ? subscription.customer
          : subscription.customer.id;

      const { data } = await supabaseAdmin
        .from("stripe_customers")
        .select("user_id")
        .eq("stripe_customer_id", customerId)
        .single();

      return data?.user_id ?? null;
    }

    // Handle specific events
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        console.log("Checkout session completed:", session.id);

        // Get user_id from session metadata
        const userId = session.metadata?.user_id;
        if (!userId) {
          console.error("No user_id in checkout session metadata");
          break;
        }

        // Store customer mapping if not already present
        if (session.customer) {
          const customerId =
            typeof session.customer === "string"
              ? session.customer
              : session.customer.id;

          await supabaseAdmin.from("stripe_customers").upsert(
            {
              user_id: userId,
              stripe_customer_id: customerId,
            },
            { onConflict: "user_id" }
          );
        }

        // If subscription was created, it will be handled by subscription.created event
        console.log("Checkout completed for user:", userId);
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        console.log(`Subscription ${event.type}:`, subscription.id, subscription.status);

        const userId = await getUserIdFromSubscription(subscription);
        if (!userId) {
          console.error("Could not determine user_id for subscription:", subscription.id);
          break;
        }

        // Upsert subscription record
        await upsertSubscription(userId, subscription);

        // Update premium status based on subscription status
        const isActive = ["active", "trialing"].includes(subscription.status);
        await updatePremiumStatus(userId, isActive);

        console.log(`User ${userId} premium status set to ${isActive}`);
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        console.log("Subscription deleted:", subscription.id);

        const userId = await getUserIdFromSubscription(subscription);
        if (!userId) {
          console.error("Could not determine user_id for subscription:", subscription.id);
          break;
        }

        // Update subscription record
        await upsertSubscription(userId, subscription);

        // Set premium to false
        await updatePremiumStatus(userId, false);

        console.log(`User ${userId} premium status set to false (subscription deleted)`);
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        console.log("Invoice payment failed:", invoice.id);

        // Log for alerting - the subscription status will be updated separately
        // by Stripe's automatic handling, triggering subscription.updated
        console.warn(
          "Payment failed for customer:",
          invoice.customer,
          "invoice:",
          invoice.id
        );
        break;
      }

      default:
        console.log("Unhandled event type:", event.type);
    }

    return new Response(JSON.stringify({ received: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    console.error("Webhook error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
