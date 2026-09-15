import { paidWeeklyPass } from "./weeklyPass.ts";
// ============================================================
// Account-aware Stripe webhook handling, written against an injected data
// layer so every branch is testable without a network or a database.
// ============================================================

import { shouldRevokePremium, type StripeAccountId } from "./stripeAccounts.ts";
import {
  checkoutGrantDecision,
  evaluateEventOrder,
  resolveCurrentPeriodEnd,
  resolveCustomerId,
  resolveInvoiceSubscriptionId,
  resolvePriceId,
  unixSecondsToIso,
} from "./stripeEvents.ts";

// deno-lint-ignore no-explicit-any
type AnyRecord = Record<string, any>;

export interface SubscriptionRow {
  user_id: string;
  stripe_subscription_id: string;
  status: string | null;
  price_id: string | null;
  current_period_end: string | null;
  last_event_id: string | null;
  last_event_created_at: string | null;
}

export interface UserFlags {
  isPremium: boolean;
  isLifetime: boolean;
  manualPremium: boolean;
}

export interface WebhookStore {
  grantWeeklyPass(userId: string, sessionId: string, weeks: number): Promise<string>;
  getFlags(userId: string): Promise<UserFlags>;
  setPremium(userId: string, value: boolean, lifetime?: boolean): Promise<void>;
  getUserIdByCustomer(account: StripeAccountId, customerId: string): Promise<string | null>;
  upsertCustomer(
    account: StripeAccountId,
    userId: string,
    customerId: string,
  ): Promise<void>;
  getSubscription(
    account: StripeAccountId,
    subscriptionId: string,
  ): Promise<Pick<SubscriptionRow, "last_event_id" | "last_event_created_at"> | null>;
  upsertSubscription(account: StripeAccountId, row: SubscriptionRow): Promise<void>;
  /** Active/trialing subscriptions for the user in ANY account, excluding one id. */
  countOtherActiveSubscriptions(userId: string, excludeSubscriptionId: string): Promise<number>;
}

export interface HandleResult {
  handled: boolean;
  action: string;
  userId?: string | null;
  details?: Record<string, unknown>;
}

const ACTIVE = ["active", "trialing"];

export async function handleStripeEvent(
  event: AnyRecord,
  account: StripeAccountId,
  store: WebhookStore,
  log: (msg: string, meta?: Record<string, unknown>) => void = () => {},
): Promise<HandleResult> {
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded":
    case "checkout.session.async_payment_failed":
    case "checkout.session.expired":
      return await handleCheckoutSession(event, account, store, log);

    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      return await handleSubscriptionEvent(event, account, store, log);

    case "invoice.payment_failed": {
      const invoice = event.data?.object ?? {};
      log("Payment failed", {
        account,
        invoiceId: invoice.id ?? null,
        subscriptionId: resolveInvoiceSubscriptionId(invoice),
      });
      // Deliberately no downgrade here: Stripe transitions the subscription to
      // past_due/unpaid/canceled itself and we act on that event.
      return { handled: true, action: "payment_failed_logged" };
    }

    default:
      log("Unhandled event type", { type: event.type });
      return { handled: false, action: "ignored" };
  }
}

async function handleCheckoutSession(
  event: AnyRecord,
  account: StripeAccountId,
  store: WebhookStore,
  log: (msg: string, meta?: Record<string, unknown>) => void,
): Promise<HandleResult> {
  const session: AnyRecord = event.data?.object ?? {};
  const userId: string | undefined = session.metadata?.user_id;
  if (!userId) {
    log("Checkout session without user_id metadata", { sessionId: session.id ?? null });
    return { handled: false, action: "missing_user_id" };
  }

  const customerId = resolveCustomerId(session.customer);
  if (customerId) await store.upsertCustomer(account, userId, customerId);

  if (session.metadata?.plan === "weekly_pass") {
    const purchase = paidWeeklyPass(session);
    if (account !== "betstreaks" || !purchase ||
      !["checkout.session.completed", "checkout.session.async_payment_succeeded"].includes(event.type)) {
      return { handled: true, action: "weekly_pass_not_paid_or_invalid", userId };
    }
    const expiresAt = await store.grantWeeklyPass(userId, purchase.sessionId, purchase.weeks);
    return { handled: true, action: "granted_weekly_pass", userId, details: { expiresAt, weeks: purchase.weeks } };
  }

  const decision = checkoutGrantDecision(session);
  log("Checkout session", {
    account,
    sessionId: session.id ?? null,
    mode: session.mode ?? null,
    paymentStatus: session.payment_status ?? null,
    plan: session.metadata?.plan ?? null,
    decision: decision.reason,
  });

  if (decision.grantLifetime) {
    await store.setPremium(userId, true, true);
    return {
      handled: true,
      action: "granted_lifetime",
      userId,
      details: { plan: session.metadata?.plan ?? null },
    };
  }

  // Subscription-mode checkouts are granted by customer.subscription.created.
  // Pending async payments are granted by async_payment_succeeded.
  return { handled: true, action: `no_grant_${decision.reason}`, userId };
}

async function handleSubscriptionEvent(
  event: AnyRecord,
  account: StripeAccountId,
  store: WebhookStore,
  log: (msg: string, meta?: Record<string, unknown>) => void,
): Promise<HandleResult> {
  const subscription: AnyRecord = event.data?.object ?? {};
  const subscriptionId: string | undefined = subscription.id;
  if (!subscriptionId) return { handled: false, action: "missing_subscription_id" };

  let userId: string | null = subscription.metadata?.user_id ?? null;
  if (!userId) {
    const customerId = resolveCustomerId(subscription.customer);
    userId = customerId ? await store.getUserIdByCustomer(account, customerId) : null;
  }
  if (!userId) {
    log("Could not determine user for subscription", { subscriptionId, account });
    return { handled: false, action: "unknown_user" };
  }

  // Ordering guard — a replayed or late delivery must not overwrite newer state.
  const existing = await store.getSubscription(account, subscriptionId);
  const order = evaluateEventOrder({
    eventId: event.id,
    eventCreated: event.created,
    storedEventId: existing?.last_event_id ?? null,
    storedEventCreatedAt: existing?.last_event_created_at ?? null,
  });
  if (!order.apply) {
    log("Skipping event", { reason: order.reason, eventId: event.id, subscriptionId });
    return { handled: true, action: `skipped_${order.reason}`, userId };
  }

  const status: string | null =
    event.type === "customer.subscription.deleted"
      ? (subscription.status ?? "canceled")
      : (subscription.status ?? null);

  await store.upsertSubscription(account, {
    user_id: userId,
    stripe_subscription_id: subscriptionId,
    status,
    price_id: resolvePriceId(subscription),
    current_period_end: unixSecondsToIso(resolveCurrentPeriodEnd(subscription)),
    last_event_id: event.id,
    last_event_created_at: unixSecondsToIso(event.created),
  });

  const isActive =
    event.type !== "customer.subscription.deleted" && ACTIVE.includes(status ?? "");

  if (isActive) {
    await store.setPremium(userId, true);
    return { handled: true, action: "granted_premium", userId, details: { status } };
  }

  const flags = await store.getFlags(userId);
  const otherActive = await store.countOtherActiveSubscriptions(userId, subscriptionId);
  const revoke = shouldRevokePremium({
    isLifetime: flags.isLifetime,
    manualPremium: flags.manualPremium,
    otherActiveSubscriptionCount: otherActive,
  });

  log("Downgrade decision", {
    userId,
    account,
    status,
    isLifetime: flags.isLifetime,
    manualPremium: flags.manualPremium,
    otherActive,
    revoke,
  });

  if (!revoke) {
    return {
      handled: true,
      action: "premium_preserved",
      userId,
      details: { isLifetime: flags.isLifetime, manualPremium: flags.manualPremium, otherActive },
    };
  }

  await store.setPremium(userId, false);
  return { handled: true, action: "revoked_premium", userId, details: { status } };
}
