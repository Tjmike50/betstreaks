import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  loadBetstreaksAccount,
  loadLegacyAccount,
  shouldRevokePremium,
  tablesForAccount,
  type AccountConfig,
  type StripeAccountId,
} from "../_shared/stripeAccounts.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, stripe-signature",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const env = (key: string) => Deno.env.get(key);

  const supabaseUrl = env("SUPABASE_URL") ?? "";
  const supabaseServiceRoleKey = env("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  const legacyAccount = loadLegacyAccount(env);
  const betstreaksAccount = loadBetstreaksAccount(env);

  // Accounts we can verify signatures for, newest first so a new-account event
  // is matched on the first attempt once the second endpoint secret exists.
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

  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false },
  });

  function unixSecondsToIso(
    value: unknown,
    fieldName: string,
    context: { eventType: string; subscriptionId?: string | null },
  ): string | null {
    if (value == null) {
      console.warn("Stripe webhook timestamp missing", {
        eventType: context.eventType,
        subscriptionId: context.subscriptionId ?? null,
        fieldName,
      });
      return null;
    }
    const seconds = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(seconds) || seconds <= 0) {
      console.warn("Stripe webhook timestamp invalid", {
        eventType: context.eventType,
        subscriptionId: context.subscriptionId ?? null,
        fieldName,
      });
      return null;
    }
    const date = new Date(seconds * 1000);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  try {
    const signature = req.headers.get("stripe-signature");
    if (!signature) {
      console.error("No stripe-signature header");
      return new Response("No signature", { status: 400 });
    }

    const body = await req.text();

    // ── Verify against each configured account's signing secret ──
    let event: Stripe.Event | null = null;
    let accountId: StripeAccountId | null = null;
    let stripe: Stripe | null = null;
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
        stripe = client;
        break;
      } catch (_err) {
        // Try the next account's secret.
      }
    }

    if (!event || !accountId || !stripe) {
      console.error("Webhook signature verification failed for all accounts", {
        attemptedAccounts: attempted,
        rawBodyLength: body.length,
      });
      return new Response("Webhook signature verification failed", { status: 400 });
    }

    const { customersTable, subscriptionsTable } = tablesForAccount(accountId);
    const isLegacy = accountId === "legacy";

    console.log("Received webhook event:", event.type, event.id, "account:", accountId);

    // ── Replay protection ──
    // Every handler below is an idempotent upsert keyed by a Stripe id, so a
    // replayed event re-writes identical state rather than duplicating it.

    async function getFlags(userId: string) {
      const { data } = await supabaseAdmin
        .from("user_flags")
        .select("is_premium, is_lifetime, manual_premium")
        .eq("user_id", userId)
        .maybeSingle();
      return {
        isPremium: Boolean(data?.is_premium),
        isLifetime: Boolean(data?.is_lifetime),
        manualPremium: Boolean(data?.manual_premium),
      };
    }

    async function grantPremium(userId: string, opts: { lifetime?: boolean } = {}) {
      console.log(`Granting premium for user ${userId}`, opts);
      const payload: Record<string, unknown> = {
        user_id: userId,
        is_premium: true,
        updated_at: new Date().toISOString(),
      };
      if (opts.lifetime) payload.is_lifetime = true;
      const { error } = await supabaseAdmin
        .from("user_flags")
        .upsert(payload, { onConflict: "user_id" });
      if (error) {
        console.error("Error updating user_flags:", error);
        throw error;
      }
    }

    /** Count active subscriptions for the user in ANY account, excluding one id. */
    async function otherActiveSubscriptionCount(userId: string, excludeSubId: string) {
      const [legacyRes, newRes] = await Promise.all([
        supabaseAdmin
          .from("stripe_subscriptions")
          .select("stripe_subscription_id")
          .eq("user_id", userId)
          .in("status", ["active", "trialing"]),
        supabaseAdmin
          .from("stripe_account_subscriptions")
          .select("stripe_subscription_id")
          .eq("user_id", userId)
          .in("status", ["active", "trialing"]),
      ]);
      const all = [...(legacyRes.data ?? []), ...(newRes.data ?? [])];
      return all.filter((r) => r.stripe_subscription_id !== excludeSubId).length;
    }

    /**
     * Never downgrade lifetime buyers, manually granted users, or someone whose
     * access is backed by an active subscription in the other account.
     */
    async function maybeRevokePremium(userId: string, subscriptionId: string) {
      const flags = await getFlags(userId);
      const otherActive = await otherActiveSubscriptionCount(userId, subscriptionId);
      const revoke = shouldRevokePremium({
        isLifetime: flags.isLifetime,
        manualPremium: flags.manualPremium,
        otherActiveSubscriptionCount: otherActive,
      });

      console.log("Downgrade decision", {
        userId,
        isLifetime: flags.isLifetime,
        manualPremium: flags.manualPremium,
        otherActive,
        revoke,
      });

      if (!revoke) return;

      const { error } = await supabaseAdmin.from("user_flags").upsert(
        { user_id: userId, is_premium: false, updated_at: new Date().toISOString() },
        { onConflict: "user_id" },
      );
      if (error) {
        console.error("Error updating user_flags:", error);
        throw error;
      }
    }

    async function upsertCustomer(userId: string, customerId: string) {
      if (isLegacy) {
        await supabaseAdmin
          .from("stripe_customers")
          .upsert(
            { user_id: userId, stripe_customer_id: customerId },
            { onConflict: "user_id" },
          );
      } else {
        await supabaseAdmin.from(customersTable).upsert(
          {
            user_id: userId,
            stripe_account: accountId,
            stripe_customer_id: customerId,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id,stripe_account" },
        );
      }
    }

    async function upsertSubscription(
      userId: string,
      subscription: Stripe.Subscription,
      eventType: string,
    ) {
      const currentPeriodEndIso = unixSecondsToIso(
        subscription.current_period_end,
        "current_period_end",
        { eventType, subscriptionId: subscription.id },
      );
      const base = {
        user_id: userId,
        stripe_subscription_id: subscription.id,
        status: subscription.status,
        price_id: subscription.items.data[0]?.price?.id ?? null,
        current_period_end: currentPeriodEndIso,
        updated_at: new Date().toISOString(),
      };

      const { error } = isLegacy
        ? await supabaseAdmin
            .from("stripe_subscriptions")
            .upsert(base, { onConflict: "stripe_subscription_id" })
        : await supabaseAdmin
            .from(subscriptionsTable)
            .upsert(
              { ...base, stripe_account: accountId },
              { onConflict: "stripe_account,stripe_subscription_id" },
            );

      if (error) {
        console.error("Error upserting subscription:", error);
        throw error;
      }
    }

    async function getUserIdFromSubscription(
      subscription: Stripe.Subscription,
    ): Promise<string | null> {
      if (subscription.metadata?.user_id) return subscription.metadata.user_id;

      const customerId =
        typeof subscription.customer === "string"
          ? subscription.customer
          : subscription.customer.id;

      if (isLegacy) {
        const { data } = await supabaseAdmin
          .from("stripe_customers")
          .select("user_id")
          .eq("stripe_customer_id", customerId)
          .maybeSingle();
        return data?.user_id ?? null;
      }

      const { data } = await supabaseAdmin
        .from(customersTable)
        .select("user_id")
        .eq("stripe_account", accountId)
        .eq("stripe_customer_id", customerId)
        .maybeSingle();
      return data?.user_id ?? null;
    }

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        console.log("Checkout session completed:", session.id, "mode:", session.mode);

        const userId = session.metadata?.user_id;
        if (!userId) {
          console.error("No user_id in checkout session metadata");
          break;
        }

        if (session.customer) {
          const customerId =
            typeof session.customer === "string" ? session.customer : session.customer.id;
          await upsertCustomer(userId, customerId);
        }

        if (session.mode === "payment" && session.payment_status === "paid") {
          const plan = session.metadata?.plan ?? "lifetime";
          const product = session.metadata?.product ?? "betstreaks";
          console.log(
            `Lifetime purchase: user=${userId} plan=${plan} product=${product} account=${accountId}`,
          );
          await grantPremium(userId, { lifetime: true });
        }

        console.log("Checkout completed for user:", userId);
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        const userId = await getUserIdFromSubscription(subscription);
        if (!userId) {
          console.error("Could not determine user_id for subscription:", subscription.id);
          break;
        }

        await upsertSubscription(userId, subscription, event.type);

        const isActive = ["active", "trialing"].includes(subscription.status);
        if (isActive) {
          await grantPremium(userId);
        } else {
          await maybeRevokePremium(userId, subscription.id);
        }

        console.log(`User ${userId} subscription ${subscription.status} on ${accountId}`);
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        const userId = await getUserIdFromSubscription(subscription);
        if (!userId) {
          console.error("Could not determine user_id for subscription:", subscription.id);
          break;
        }

        await upsertSubscription(userId, subscription, event.type);
        await maybeRevokePremium(userId, subscription.id);
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        console.warn("Payment failed", {
          account: accountId,
          invoiceId: invoice.id,
        });
        break;
      }

      default:
        console.log("Unhandled event type:", event.type);
    }

    return new Response(JSON.stringify({ received: true, account: accountId }), {
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
      },
    );
  }
});
