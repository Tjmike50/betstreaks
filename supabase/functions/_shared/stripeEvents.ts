// ============================================================
// Pure helpers for Stripe event shapes.
//
// Target API version: 2026-08-26.dahlia (post-Basil). Two shape changes matter
// to us and both are handled with a new-shape-first / legacy-fallback reader so
// the same code keeps working for events replayed from the old account, which
// is pinned to an older API version:
//
//   1. Subscription.current_period_end moved onto each subscription item
//      (subscription.items.data[].current_period_end).
//   2. Invoice.subscription was removed in favour of
//      invoice.parent.subscription_details.subscription.
// ============================================================

// deno-lint-ignore no-explicit-any
type AnyRecord = Record<string, any>;

export function unixSecondsToIso(value: unknown): string | null {
  if (value == null) return null;
  const seconds = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const date = new Date(seconds * 1000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * Current period end, dahlia-first.
 * Falls back to the pre-Basil top-level field for older replays.
 * With multiple items we take the furthest-out period so access is never cut
 * short by a shorter-cycle add-on item.
 */
export function resolveCurrentPeriodEnd(subscription: AnyRecord): number | null {
  const items: AnyRecord[] = subscription?.items?.data ?? [];
  const itemEnds = items
    .map((item) => item?.current_period_end)
    .filter((v): v is number => typeof v === "number" && v > 0);
  if (itemEnds.length > 0) return Math.max(...itemEnds);

  const legacy = subscription?.current_period_end;
  return typeof legacy === "number" && legacy > 0 ? legacy : null;
}

export function resolvePriceId(subscription: AnyRecord): string | null {
  const items: AnyRecord[] = subscription?.items?.data ?? [];
  return items[0]?.price?.id ?? items[0]?.plan?.id ?? null;
}

/** Subscription reference on an invoice, dahlia-first. */
export function resolveInvoiceSubscriptionId(invoice: AnyRecord): string | null {
  const parentRef = invoice?.parent?.subscription_details?.subscription;
  if (typeof parentRef === "string") return parentRef;
  if (parentRef?.id) return parentRef.id;

  const lineRef = (invoice?.lines?.data ?? [])
    .map((l: AnyRecord) => l?.parent?.subscription_item_details?.subscription)
    .find((v: unknown) => typeof v === "string");
  if (typeof lineRef === "string") return lineRef;

  const legacy = invoice?.subscription;
  if (typeof legacy === "string") return legacy;
  if (legacy?.id) return legacy.id;
  return null;
}

export function resolveCustomerId(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "id" in (value as AnyRecord)) {
    const id = (value as AnyRecord).id;
    return typeof id === "string" ? id : null;
  }
  return null;
}

export interface EventOrderInput {
  /** event.id of the incoming delivery. */
  eventId: string;
  /** event.created (unix seconds) of the incoming delivery. */
  eventCreated: number;
  /** last_event_id already recorded for this subscription row. */
  storedEventId?: string | null;
  /** last_event_created_at (ISO) already recorded for this subscription row. */
  storedEventCreatedAt?: string | null;
}

export type EventOrderDecision =
  | { apply: true; reason: "first_event" | "newer_event" }
  | { apply: false; reason: "duplicate_event" | "stale_event" };

/**
 * Idempotent upserts alone do NOT protect subscription state: a replayed or
 * out-of-order delivery would happily overwrite newer state with older values.
 * We therefore compare Stripe's own event ordering before writing.
 */
export function evaluateEventOrder(input: EventOrderInput): EventOrderDecision {
  if (input.storedEventId && input.storedEventId === input.eventId) {
    return { apply: false, reason: "duplicate_event" };
  }
  if (!input.storedEventCreatedAt) {
    return { apply: true, reason: "first_event" };
  }
  const stored = Date.parse(input.storedEventCreatedAt);
  if (!Number.isFinite(stored)) return { apply: true, reason: "first_event" };
  const incoming = input.eventCreated * 1000;
  if (incoming < stored) return { apply: false, reason: "stale_event" };
  return { apply: true, reason: "newer_event" };
}

/**
 * Should a checkout session grant lifetime access yet?
 *
 * With dynamic payment methods a one-time checkout can complete while the
 * payment is still processing: checkout.session.completed arrives with
 * payment_status "unpaid", and checkout.session.async_payment_succeeded (or
 * .async_payment_failed) follows later. We only grant on a paid payment.
 */
export function checkoutGrantDecision(session: AnyRecord): {
  grantLifetime: boolean;
  reason: "paid_one_time" | "subscription_mode" | "payment_pending" | "payment_failed";
} {
  if (session?.mode !== "payment") {
    return { grantLifetime: false, reason: "subscription_mode" };
  }
  if (session?.payment_status === "paid" || session?.payment_status === "no_payment_required") {
    return { grantLifetime: true, reason: "paid_one_time" };
  }
  if (session?.status === "expired") {
    return { grantLifetime: false, reason: "payment_failed" };
  }
  return { grantLifetime: false, reason: "payment_pending" };
}

/** Events the endpoint must be subscribed to for correct behaviour. */
export const REQUIRED_WEBHOOK_EVENTS = [
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "checkout.session.expired",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.payment_failed",
] as const;
