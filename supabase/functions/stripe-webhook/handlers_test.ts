import { assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";
import {
  handleStripeEvent,
  type SubscriptionRow,
  type WebhookStore,
} from "../_shared/stripeWebhookHandlers.ts";
import {
  REQUIRED_WEBHOOK_EVENTS,
  resolveCurrentPeriodEnd,
  resolveInvoiceSubscriptionId,
} from "../_shared/stripeEvents.ts";
import type { StripeAccountId, StripeCustomerScope } from "../_shared/stripeAccounts.ts";

// ── In-memory store ────────────────────────────────────────────
interface Flags { is_premium: boolean; is_lifetime: boolean; manual_premium: boolean }

function makeStore(seed: {
  flags?: Record<string, Partial<Flags>>;
  customers?: Array<{ account: StripeCustomerScope; customerId: string; userId: string }>;
  subscriptions?: Array<{ account: StripeAccountId } & SubscriptionRow>;
} = {}) {
  const flags = new Map<string, Flags>();
  for (const [id, f] of Object.entries(seed.flags ?? {})) {
    flags.set(id, { is_premium: false, is_lifetime: false, manual_premium: false, ...f });
  }
  const customers = [...(seed.customers ?? [])];
  const subscriptions = [...(seed.subscriptions ?? [])];

  const weeklyGrants: Array<{ userId: string; sessionId: string; weeks: number }> = [];
  const store: WebhookStore = {
    grantWeeklyPass: (userId, sessionId, weeks) => { weeklyGrants.push({ userId, sessionId, weeks }); return Promise.resolve("2027-07-13T00:00:00Z"); },
    getFlags: (userId) =>
      Promise.resolve({
        isPremium: Boolean(flags.get(userId)?.is_premium),
        isLifetime: Boolean(flags.get(userId)?.is_lifetime),
        manualPremium: Boolean(flags.get(userId)?.manual_premium),
      }),
    setPremium: (userId, value, lifetime) => {
      const prev = flags.get(userId) ??
        { is_premium: false, is_lifetime: false, manual_premium: false };
      flags.set(userId, { ...prev, is_premium: value, is_lifetime: prev.is_lifetime || !!lifetime });
      return Promise.resolve();
    },
    getUserIdByCustomer: (account, customerId) =>
      Promise.resolve(
        customers.find((c) => c.account === account && c.customerId === customerId)?.userId ?? null,
      ),
    upsertCustomer: (account, userId, customerId) => {
      const i = customers.findIndex((c) => c.account === account && c.userId === userId);
      if (i >= 0) customers[i] = { account, userId, customerId };
      else customers.push({ account, userId, customerId });
      return Promise.resolve();
    },
    getSubscription: (account, id) => {
      const row = subscriptions.find(
        (s) => s.account === account && s.stripe_subscription_id === id,
      );
      return Promise.resolve(
        row
          ? { last_event_id: row.last_event_id, last_event_created_at: row.last_event_created_at }
          : null,
      );
    },
    upsertSubscription: (account, row) => {
      const i = subscriptions.findIndex(
        (s) => s.account === account && s.stripe_subscription_id === row.stripe_subscription_id,
      );
      if (i >= 0) subscriptions[i] = { account, ...row };
      else subscriptions.push({ account, ...row });
      return Promise.resolve();
    },
    countOtherActiveSubscriptions: (userId, excludeId) =>
      Promise.resolve(
        subscriptions.filter(
          (s) =>
            s.user_id === userId &&
            s.stripe_subscription_id !== excludeId &&
            ["active", "trialing"].includes(s.status ?? ""),
        ).length,
      ),
  };

  return { store, flags, customers, subscriptions, weeklyGrants };
}

const NOW = Math.floor(Date.parse("2026-09-15T12:00:00Z") / 1000);

// dahlia-shaped subscription: period end lives on the item
function subEvent(opts: {
  id?: string;
  created?: number;
  type: string;
  subId?: string;
  status: string;
  customer?: string;
  userId?: string;
}) {
  return {
    id: opts.id ?? "evt_1",
    created: opts.created ?? NOW,
    type: opts.type,
    data: {
      object: {
        id: opts.subId ?? "sub_1",
        status: opts.status,
        customer: opts.customer ?? "cus_new",
        metadata: opts.userId ? { user_id: opts.userId } : {},
        items: {
          data: [{ price: { id: "price_1UG21bAHW2dqNeWSUccrYHEv" }, current_period_end: NOW + 2592000 }],
        },
      },
    },
  };
}

function checkoutEvent(opts: {
  type?: string;
  mode: string;
  payment_status?: string;
  plan: string;
  userId?: string;
}) {
  return {
    id: "evt_co_1",
    created: NOW,
    type: opts.type ?? "checkout.session.completed",
    data: {
      object: {
        id: "cs_1",
        mode: opts.mode,
        payment_status: opts.payment_status ?? "paid",
        customer: "cus_new",
        metadata: { user_id: opts.userId ?? "user_a", plan: opts.plan },
      },
    },
  };
}

// ── Shape tests (API version 2026-08-26.dahlia) ────────────────
Deno.test("period end read from subscription item (dahlia)", () => {
  assertEquals(
    resolveCurrentPeriodEnd({ items: { data: [{ current_period_end: 1800 }] } }),
    1800,
  );
});

Deno.test("period end falls back to legacy top-level field", () => {
  assertEquals(resolveCurrentPeriodEnd({ current_period_end: 900, items: { data: [{}] } }), 900);
});

Deno.test("invoice subscription read from parent.subscription_details (dahlia)", () => {
  assertEquals(
    resolveInvoiceSubscriptionId({ parent: { subscription_details: { subscription: "sub_9" } } }),
    "sub_9",
  );
  assertEquals(resolveInvoiceSubscriptionId({ subscription: "sub_old" }), "sub_old");
});

// ── Checkout modes ─────────────────────────────────────────────
Deno.test("checkout: monthly subscription grants nothing directly", async () => {
  const { store, flags } = makeStore();
  const r = await handleStripeEvent(
    checkoutEvent({ mode: "subscription", plan: "monthly" }),
    "betstreaks",
    store,
  );
  assertEquals(r.action, "no_grant_subscription_mode");
  assertEquals(flags.get("user_a"), undefined);
});

Deno.test("checkout: yearly subscription grants nothing directly", async () => {
  const { store } = makeStore();
  const r = await handleStripeEvent(
    checkoutEvent({ mode: "subscription", plan: "yearly" }),
    "betstreaks",
    store,
  );
  assertEquals(r.action, "no_grant_subscription_mode");
});

Deno.test("checkout: lifetime one-time paid grants lifetime premium", async () => {
  const { store, flags } = makeStore();
  const r = await handleStripeEvent(
    checkoutEvent({ mode: "payment", plan: "lifetime" }),
    "betstreaks",
    store,
  );
  assertEquals(r.action, "granted_lifetime");
  assertEquals(flags.get("user_a")?.is_premium, true);
  assertEquals(flags.get("user_a")?.is_lifetime, true);
});

Deno.test("checkout: all-apps lifetime paid grants lifetime premium", async () => {
  const { store, flags } = makeStore();
  const r = await handleStripeEvent(
    checkoutEvent({ mode: "payment", plan: "all_apps_lifetime" }),
    "betstreaks",
    store,
  );
  assertEquals(r.action, "granted_lifetime");
  assertEquals(flags.get("user_a")?.is_lifetime, true);
});

// ── Delayed (async) payments ───────────────────────────────────
Deno.test("delayed payment: unpaid completion does not grant, later success does", async () => {
  const { store, flags } = makeStore();
  const pending = await handleStripeEvent(
    checkoutEvent({ mode: "payment", plan: "lifetime", payment_status: "unpaid" }),
    "betstreaks",
    store,
  );
  assertEquals(pending.action, "no_grant_payment_pending");
  assertEquals(flags.get("user_a"), undefined);

  const success = await handleStripeEvent(
    checkoutEvent({
      type: "checkout.session.async_payment_succeeded",
      mode: "payment",
      plan: "lifetime",
      payment_status: "paid",
    }),
    "betstreaks",
    store,
  );
  assertEquals(success.action, "granted_lifetime");
  assertEquals(flags.get("user_a")?.is_premium, true);
});

Deno.test("delayed payment: async failure never grants", async () => {
  const { store, flags } = makeStore();
  const r = await handleStripeEvent(
    checkoutEvent({
      type: "checkout.session.async_payment_failed",
      mode: "payment",
      plan: "lifetime",
      payment_status: "unpaid",
    }),
    "betstreaks",
    store,
  );
  assertEquals(r.action, "no_grant_payment_pending");
  assertEquals(flags.get("user_a"), undefined);
});

// ── Duplicate / out-of-order deliveries ────────────────────────
Deno.test("duplicate delivery of the same event is skipped", async () => {
  const { store, subscriptions } = makeStore({
    customers: [{ account: "betstreaks", customerId: "cus_new", userId: "user_a" }],
  });
  const ev = subEvent({ type: "customer.subscription.created", status: "active" });
  assertEquals((await handleStripeEvent(ev, "betstreaks", store)).action, "granted_premium");
  assertEquals(
    (await handleStripeEvent(ev, "betstreaks", store)).action,
    "skipped_duplicate_event",
  );
  assertEquals(subscriptions.length, 1);
});

Deno.test("stale out-of-order cancellation cannot overwrite newer active state", async () => {
  const { store, flags, subscriptions } = makeStore({
    customers: [{ account: "betstreaks", customerId: "cus_new", userId: "user_a" }],
  });
  // newer event first
  await handleStripeEvent(
    subEvent({ id: "evt_new", created: NOW + 100, type: "customer.subscription.updated", status: "active" }),
    "betstreaks",
    store,
  );
  // older delivery arrives late
  const late = await handleStripeEvent(
    subEvent({ id: "evt_old", created: NOW, type: "customer.subscription.deleted", status: "canceled" }),
    "betstreaks",
    store,
  );
  assertEquals(late.action, "skipped_stale_event");
  assertEquals(subscriptions[0].status, "active");
  assertEquals(flags.get("user_a")?.is_premium, true);
});

// ── Cross-account isolation ────────────────────────────────────
Deno.test("customer id from the other account is not resolved", async () => {
  const { store, flags } = makeStore({
    customers: [{ account: "legacy", customerId: "cus_legacy", userId: "user_a" }],
  });
  const r = await handleStripeEvent(
    subEvent({ type: "customer.subscription.created", status: "active", customer: "cus_legacy" }),
    "betstreaks",
    store,
  );
  assertEquals(r.action, "unknown_user");
  assertEquals(flags.get("user_a"), undefined);
});

Deno.test("subscription rows are written per account, not merged", async () => {
  const { store, subscriptions } = makeStore({
    customers: [
      { account: "legacy", customerId: "cus_legacy", userId: "user_a" },
      { account: "betstreaks", customerId: "cus_new", userId: "user_a" },
    ],
  });
  await handleStripeEvent(
    subEvent({ id: "e1", type: "customer.subscription.created", status: "active", subId: "sub_L", customer: "cus_legacy" }),
    "legacy",
    store,
  );
  await handleStripeEvent(
    subEvent({ id: "e2", type: "customer.subscription.created", status: "active", subId: "sub_B", customer: "cus_new" }),
    "betstreaks",
    store,
  );
  assertEquals(subscriptions.map((s) => `${s.account}:${s.stripe_subscription_id}`), [
    "legacy:sub_L",
    "betstreaks:sub_B",
  ]);
});

// ── Premium preservation ───────────────────────────────────────
Deno.test("cancellation preserves lifetime premium", async () => {
  const { store, flags } = makeStore({
    flags: { user_a: { is_premium: true, is_lifetime: true } },
    customers: [{ account: "betstreaks", customerId: "cus_new", userId: "user_a" }],
  });
  const r = await handleStripeEvent(
    subEvent({ type: "customer.subscription.deleted", status: "canceled", userId: "user_a" }),
    "betstreaks",
    store,
  );
  assertEquals(r.action, "premium_preserved");
  assertEquals(flags.get("user_a")?.is_premium, true);
});

Deno.test("cancellation preserves manually granted premium", async () => {
  const { store, flags } = makeStore({
    flags: { user_a: { is_premium: true, manual_premium: true } },
  });
  const r = await handleStripeEvent(
    subEvent({ type: "customer.subscription.deleted", status: "canceled", userId: "user_a" }),
    "betstreaks",
    store,
  );
  assertEquals(r.action, "premium_preserved");
  assertEquals(flags.get("user_a")?.is_premium, true);
});

Deno.test("cancellation preserves premium backed by the other account", async () => {
  const { store, flags } = makeStore({
    flags: { user_a: { is_premium: true } },
    subscriptions: [{
      account: "legacy",
      user_id: "user_a",
      stripe_subscription_id: "sub_L",
      status: "active",
      price_id: null,
      current_period_end: null,
      last_event_id: null,
      last_event_created_at: null,
    }],
  });
  const r = await handleStripeEvent(
    subEvent({ type: "customer.subscription.deleted", status: "canceled", subId: "sub_B", userId: "user_a" }),
    "betstreaks",
    store,
  );
  assertEquals(r.action, "premium_preserved");
  assertEquals(flags.get("user_a")?.is_premium, true);
});

Deno.test("cancellation with no protection revokes premium", async () => {
  const { store, flags } = makeStore({ flags: { user_a: { is_premium: true } } });
  const r = await handleStripeEvent(
    subEvent({ type: "customer.subscription.deleted", status: "canceled", userId: "user_a" }),
    "betstreaks",
    store,
  );
  assertEquals(r.action, "revoked_premium");
  assertEquals(flags.get("user_a")?.is_premium, false);
});

Deno.test("invoice.payment_failed never downgrades", async () => {
  const { store, flags } = makeStore({ flags: { user_a: { is_premium: true } } });
  const r = await handleStripeEvent(
    {
      id: "evt_inv",
      created: NOW,
      type: "invoice.payment_failed",
      data: { object: { id: "in_1", parent: { subscription_details: { subscription: "sub_B" } } } },
    },
    "betstreaks",
    store,
  );
  assertEquals(r.action, "payment_failed_logged");
  assertEquals(flags.get("user_a")?.is_premium, true);
});

// ── Signature verification ─────────────────────────────────────
const SECRET_A = "whsec_test_account_a_secret";
const SECRET_B = "whsec_test_account_b_secret";

async function verify(payload: string, header: string, secret: string) {
  const stripe = new Stripe("sk_test_dummy", { apiVersion: "2023-10-16" });
  return await stripe.webhooks.constructEventAsync(
    payload,
    header,
    secret,
    undefined,
    Stripe.createSubtleCryptoProvider(),
  );
}

async function sign(payload: string, secret: string, timestamp = Math.floor(Date.now() / 1000)) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", key, encoder.encode(`${timestamp}.${payload}`));
  const signature = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `t=${timestamp},v1=${signature}`;
}

Deno.test("signature: valid header for the matching secret is accepted", async () => {
  const payload = JSON.stringify({ id: "evt_sig", type: "ping", created: NOW });
  const event = await verify(payload, await sign(payload, SECRET_A), SECRET_A);
  assertEquals(event.id, "evt_sig");
});

Deno.test("signature: header signed by the other account is rejected", async () => {
  const payload = JSON.stringify({ id: "evt_sig", type: "ping", created: NOW });
  const header = await sign(payload, SECRET_B);
  let rejected = false;
  try {
    await verify(payload, header, SECRET_A);
  } catch {
    rejected = true;
  }
  assertEquals(rejected, true);
});

Deno.test("signature: tampered payload is rejected", async () => {
  const payload = JSON.stringify({ id: "evt_sig", type: "ping", created: NOW });
  const header = await sign(payload, SECRET_A);
  let rejected = false;
  try {
    await verify(payload.replace("evt_sig", "evt_bad"), header, SECRET_A);
  } catch {
    rejected = true;
  }
  assertEquals(rejected, true);
});

Deno.test("signature: replayed old timestamp is rejected by tolerance", async () => {
  const payload = JSON.stringify({ id: "evt_sig", type: "ping", created: NOW });
  const old = Math.floor(Date.now() / 1000) - 60 * 60 * 24;
  const header = await sign(payload, SECRET_A, old);
  let rejected = false;
  try {
    await verify(payload, header, SECRET_A);
  } catch {
    rejected = true;
  }
  assertEquals(rejected, true);
});

Deno.test("required event list is the documented set", () => {
  assertEquals(REQUIRED_WEBHOOK_EVENTS.length, 8);
});

for (const weeks of [9, 43]) {
  Deno.test(`paid ${weeks}-week pass grants time without lifetime flags`, async () => {
    const { store, flags, weeklyGrants } = makeStore();
    const event = checkoutEvent({ mode: "payment", plan: "weekly_pass" });
    Object.assign(event.data.object, { currency: "usd", amount_total: weeks * 500 });
    Object.assign(event.data.object.metadata, { weeks: String(weeks) });
    const result = await handleStripeEvent(event, "betstreaks", store);
    assertEquals(result.action, "granted_weekly_pass");
    assertEquals(weeklyGrants, [{ userId: "user_a", sessionId: "cs_1", weeks }]);
    assertEquals(flags.size, 0);
  });
}
Deno.test("pending weekly payment waits for successful async payment", async () => {
  const { store, flags, weeklyGrants } = makeStore();
  const event = checkoutEvent({ mode: "payment", plan: "weekly_pass", payment_status: "unpaid" });
  Object.assign(event.data.object, { currency: "usd", amount_total: 4500 });
  Object.assign(event.data.object.metadata, { weeks: "9" });
  await handleStripeEvent(event, "betstreaks", store);
  assertEquals(weeklyGrants.length, 0);
  event.type = "checkout.session.async_payment_succeeded";
  event.data.object.payment_status = "paid";
  await handleStripeEvent(event, "betstreaks", store);
  assertEquals(weeklyGrants.length, 1);
  assertEquals(flags.size, 0);
});
