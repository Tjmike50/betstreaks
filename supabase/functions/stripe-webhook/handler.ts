import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  loadBetstreaksAccount,
  loadLegacyAccount,
  loadTestAccount,
  TEST_CUSTOMER_SCOPE,
  type AccountConfig,
  type StripeCustomerScope,
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
  const isLegacy = (a: StripeCustomerScope) => a === "legacy";

  return {
    async grantWeeklyPass(userId, sessionId, weeks) {
      const { data, error } = await db.rpc("grant_weekly_pass", {
        p_user_id: userId, p_checkout_session_id: sessionId, p_weeks: weeks,
      });
      if (error) throw error;
      return data as string;
    },
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
          .eq("stripe_account", "betstreaks")
          .eq("user_id", userId)
          .in("status", ["active", "trialing"]),
      ]);
      const all = [...(legacyRes.data ?? []), ...(newRes.data ?? [])];
      return all.filter((r) => r.stripe_subscription_id !== excludeSubscriptionId).length;
    },
  };
}

export async function handleWebhookRequest(req: Request, dependencies: {
  env?: (key: string) => string | undefined;
  createClient?: typeof createClient;
} = {}): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const env = dependencies.env ?? ((key: string) => Deno.env.get(key));
  const supabaseUrl = env("SUPABASE_URL") ?? "";
  const supabaseServiceRoleKey = env("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  const legacyAccount = loadLegacyAccount(env);
  const betstreaksAccount = loadBetstreaksAccount(env);
  // Accept delayed sandbox deliveries even after test checkout is switched off.
  const testAccount = loadTestAccount(env);

  // Each signature is bound to its configured scope and event mode.
  const verifiable: AccountConfig[] = [testAccount, betstreaksAccount, legacyAccount].filter(
    (a): a is AccountConfig => Boolean(a && a.webhookSecret),
  );

  if (!supabaseUrl || !supabaseServiceRoleKey || verifiable.length === 0) {
    console.error("Webhook configuration error", {
      hasSupabaseUrl: Boolean(supabaseUrl),
      hasServiceRoleKey: Boolean(supabaseServiceRoleKey),
      verifiableAccounts: verifiable.map((a) => a.customerScope),
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
    let account: AccountConfig | null = null;
    const attempted: StripeCustomerScope[] = [];

    for (const candidate of verifiable) {
      attempted.push(candidate.customerScope);
      const client = new Stripe(candidate.secretKey, { apiVersion: "2023-10-16" });
      const cryptoProvider = Stripe.createSubtleCryptoProvider();
      try {
        const verified = await client.webhooks.constructEventAsync(
          body,
          signature,
          candidate.webhookSecret!,
          undefined,
          cryptoProvider,
        );
        if (verified.livemode !== (candidate.customerScope !== TEST_CUSTOMER_SCOPE)) continue;
        event = verified;
        account = candidate;
        break;
      } catch (_err) {
        // Try the next account's signing secret.
      }
    }

    if (!event || !account) {
      console.error("Webhook signature verification failed for all accounts", {
        attemptedAccounts: attempted,
        rawBodyLength: body.length,
      });
      return new Response("Webhook signature verification failed", { status: 400 });
    }

    const supabaseAdmin = (dependencies.createClient ?? createClient)(supabaseUrl, supabaseServiceRoleKey, {
      auth: { persistSession: false },
    });

    console.log("Received webhook event:", event.type, event.id, "scope:", account.customerScope);

    const result = await handleStripeEvent(
      event as unknown as Record<string, unknown>,
      account.id,
      createSupabaseStore(supabaseAdmin),
      (msg, meta) => console.log(msg, meta ?? {}),
      account.customerScope,
    );

    console.log("Webhook result", { account: account.customerScope, type: event.type, ...result });

    return new Response(
      JSON.stringify({ received: true, account: account.customerScope, action: result.action }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
    );
  } catch (error) {
    console.error("Webhook processing failed");
    return new Response(
      JSON.stringify({ error: "Webhook processing failed" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 },
    );
  }
}
