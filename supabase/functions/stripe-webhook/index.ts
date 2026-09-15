import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  loadBetstreaksAccount,
  loadLegacyAccount,
  type AccountConfig,
  type StripeAccountId,
} from "../_shared/stripeAccounts.ts";
import {
  handleStripeEvent,
  type SubscriptionRow,
  type WebhookStore,
} from "../_shared/stripeWebhookHandlers.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, stripe-signature",
};

/** Supabase-backed data layer. Legacy rows keep their existing table shape. */
export function createSupabaseStore(db: SupabaseClient): WebhookStore {
  const isLegacy = (a: StripeAccountId) => a === "legacy";

  return {
    async getFlags(userId) {
      const { data } = await db
        .from("user_flags")
        .select("is_premium, is_lifetime, manual_premium")
        .eq("user_id", userId)
        .maybeSingle();
      return {
        isPremium: Boolean(data?.is_premium),
        isLifetime: Boolean(data?.is_lifetime),
        manualPremium: Boolean(data?.manual_premium),
      };
    },

    async setPremium(userId, value, lifetime) {
      const payload: Record<string, unknown> = {
        user_id: userId,
        is_premium: value,
        updated_at: new Date().toISOString(),
      };
      if (lifetime) payload.is_lifetime = true;
      const { error } = await db.from("user_flags").upsert(payload, { onConflict: "user_id" });
      if (error) throw error;
    },

    async getUserIdByCustomer(account, customerId) {
      if (isLegacy(account)) {
        const { data } = await db
          .from("stripe_customers")
          .select("user_id")
          .eq("stripe_customer_id", customerId)
          .maybeSingle();
        return data?.user_id ?? null;
      }
      const { data } = await db
        .from("stripe_account_customers")
        .select("user_id")
        .eq("stripe_account", account)
        .eq("stripe_customer_id", customerId)
        .maybeSingle();
      return data?.user_id ?? null;
    },

    async upsertCustomer(account, userId, customerId) {
      if (isLegacy(account)) {
        const { error } = await db
          .from("stripe_customers")
          .upsert({ user_id: userId, stripe_customer_id: customerId }, { onConflict: "user_id" });
        if (error) throw error;
        return;
      }
      const { error } = await db.from("stripe_account_customers").upsert(
        {
          user_id: userId,
          stripe_account: account,
          stripe_customer_id: customerId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,stripe_account" },
      );
      if (error) throw error;
    },

    async getSubscription(account, subscriptionId) {
      if (isLegacy(account)) {
        const { data } = await db
          .from("stripe_subscriptions")
          .select("last_event_id, last_event_created_at")
          .eq("stripe_subscription_id", subscriptionId)
          .maybeSingle();
        return data ?? null;
      }
      const { data } = await db
        .from("stripe_account_subscriptions")
        .select("last_event_id, last_event_created_at")
        .eq("stripe_account", account)
        .eq("stripe_subscription_id", subscriptionId)
        .maybeSingle();
      return data ?? null;
    },

    async upsertSubscription(account, row: SubscriptionRow) {
      const base = { ...row, updated_at: new Date().toISOString() };
      const { error } = isLegacy(account)
        ? await db
            .from("stripe_subscriptions")
            .upsert(base, { onConflict: "stripe_subscription_id" })
        : await db
            .from("stripe_account_subscriptions")
            .upsert(
              { ...base, stripe_account: account },
              { onConflict: "stripe_account,stripe_subscription_id" },
            );
      if (error) throw error;
    },

    async countOtherActiveSubscriptions(userId, excludeSubscriptionId) {
      const [legacyRes, newRes] = await Promise.all([
        db
          .from("stripe_subscriptions")
          .select("stripe_subscription_id")
          .eq("user_id", userId)
          .in("status", ["active", "trialing"]),
        db
          .from("stripe_account_subscriptions")
          .select("stripe_subscription_id")
          .eq("user_id", userId)
          .in("status", ["active", "trialing"]),
      ]);
      const all = [...(legacyRes.data ?? []), ...(newRes.data ?? [])];
      return all.filter((r) => r.stripe_subscription_id !== excludeSubscriptionId).length;
    },
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const env = (key: string) => Deno.env.get(key);
  const supabaseUrl = env("SUPABASE_URL") ?? "";
  const supabaseServiceRoleKey = env("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  const legacyAccount = loadLegacyAccount(env);
  const betstreaksAccount = loadBetstreaksAccount(env);

  // Newest account first so new-account events match on the first attempt.
  const verifiable: AccountConfig[] = [betstreaksAccount, legacyAccount].filter(
    (a): a is AccountConfig => Boolean(a && a.webhookSecret),
  );

  if (!supabaseUrl || !supabaseServiceRoleKey || verifiable.length === 0) {
    console.error("Webhook configuration error", {
      hasSupabaseUrl: Boolean(supabaseUrl),
      hasServiceRoleKey: Boolean(supabaseServiceRoleKey),
      verifiableAccounts: verifiable.map((a) => a.id),
    });
    return new Response("Webhook configuration error", { status: 500 });
  }

  try {
    const signature = req.headers.get("stripe-signature");
    if (!signature) {
      console.error("No stripe-signature header");
      return new Response("No signature", { status: 400 });
    }

    const body = await req.text();

    let event: Stripe.Event | null = null;
    let accountId: StripeAccountId | null = null;
    const attempted: StripeAccountId[] = [];

    for (const candidate of verifiable) {
      attempted.push(candidate.id);
      const client = new Stripe(candidate.secretKey, { apiVersion: "2023-10-16" });
      const cryptoProvider = Stripe.createSubtleCryptoProvider();
      try {
        event = await client.webhooks.constructEventAsync(
          body,
          signature,
          candidate.webhookSecret!,
          undefined,
          cryptoProvider,
        );
        accountId = candidate.id;
        break;
      } catch (_err) {
        // Try the next account's signing secret.
      }
    }

    if (!event || !accountId) {
      console.error("Webhook signature verification failed for all accounts", {
        attemptedAccounts: attempted,
        rawBodyLength: body.length,
      });
      return new Response("Webhook signature verification failed", { status: 400 });
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { persistSession: false },
    });

    console.log("Received webhook event:", event.type, event.id, "account:", accountId);

    const result = await handleStripeEvent(
      event as unknown as Record<string, unknown>,
      accountId,
      createSupabaseStore(supabaseAdmin),
      (msg, meta) => console.log(msg, meta ?? {}),
    );

    console.log("Webhook result", { account: accountId, type: event.type, ...result });

    return new Response(
      JSON.stringify({ received: true, account: accountId, action: result.action }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
    );
  } catch (error) {
    console.error("Webhook error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 },
    );
  }
});
