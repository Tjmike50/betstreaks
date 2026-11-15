import { assertEquals, assert } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { handleWebhookRequest } from "./handler.ts";
import { billingDatabase, billingEnv, envReader, signEvent } from "../_shared/testing/billingFixtures.ts";

function event(type = "checkout.session.completed", plan = "weekly_pass") {
  return {
    id: "evt_fixture",
    type,
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    data: { object: {
      id: type.startsWith("customer.subscription") ? "sub_fixture" : "cs_test_fixture",
      livemode: false,
      customer: "cus_sandbox",
      mode: "payment",
      status: "active",
      payment_status: "paid",
      currency: "usd",
      amount_total: 4500,
      metadata: { user_id: "user_a", plan, weeks: "9", stripe_account: "betstreaks" },
    } },
  };
}
const seed = {
  stripe_account_customers: [{ user_id: "user_a", stripe_account: "betstreaks", stripe_customer_id: "cus_live" }],
  stripe_account_subscriptions: [{ user_id: "user_a", stripe_account: "betstreaks", stripe_subscription_id: "sub_live", status: "active" }],
  user_flags: [{ user_id: "user_a", is_premium: true, is_lifetime: false }],
  premium_weekly_passes: [{ user_id: "user_a", checkout_session_id: "cs_live_fixture" }],
};
async function deliver(database: ReturnType<typeof billingDatabase>, payload: unknown, options: {
  secret?: string; changes?: Record<string, string | undefined>; tamper?: boolean;
} = {}) {
  const body = JSON.stringify(payload);
  const signature = await signEvent(body, options.secret);
  return await handleWebhookRequest(new Request("https://fixture.invalid/webhook", {
    method: "POST", headers: { "stripe-signature": signature },
    body: options.tamper ? body + " " : body,
  }), { env: envReader(options.changes), createClient: database.createClient });
}

for (const [type, plan] of [
  ["checkout.session.completed", "weekly_pass"],
  ["checkout.session.async_payment_succeeded", "weekly_pass"],
  ["checkout.session.async_payment_failed", "weekly_pass"],
  ["checkout.session.expired", "weekly_pass"],
  ["checkout.session.completed", "lifetime"],
  ["checkout.session.completed", "all_apps_lifetime"],
  ["customer.subscription.created", "monthly"],
  ["customer.subscription.updated", "monthly"],
  ["customer.subscription.deleted", "monthly"],
]) {
  Deno.test(`signed sandbox ${type}/${plan} stores isolated customer without touching live billing`, async () => {
    const db = billingDatabase(seed);
    const ev = event(type, plan);
    for (let i = 0; i < 2; i++) { // Retries remain isolated too.
      const response = await deliver(db, ev);
      assertEquals(response.status, 200);
      assertEquals((await response.json()).action, "sandbox_customer_recorded");
    }
    assertEquals(db.rows.stripe_account_customers.map((r) => [r.stripe_account, r.stripe_customer_id]), [
      ["betstreaks", "cus_live"], ["betstreaks_test", "cus_sandbox"],
    ]);
    assertEquals(db.rows.user_flags, seed.user_flags);
    assertEquals(db.rows.stripe_account_subscriptions, seed.stripe_account_subscriptions);
    assertEquals(db.rows.premium_weekly_passes, seed.premium_weekly_passes);
    assertEquals(db.rpcCalls, []);
    assert(db.writes.every((w) => w.table === "stripe_account_customers" && w.row.stripe_account === "betstreaks_test"));
  });
}
Deno.test("sandbox customer resolution cannot read live mapping even with identical customer ID", async () => {
  const db = billingDatabase(seed);
  const ev = event("customer.subscription.updated");
  ev.data.object.metadata.user_id = "";
  delete (ev.data.object.metadata as Partial<typeof ev.data.object.metadata>).user_id;
  ev.data.object.customer = "cus_live";
  assertEquals((await (await deliver(db, ev)).json()).action, "unknown_user");
  assertEquals(db.writes, []);
  assert(db.reads.every((r) => r.filters.some(([k, v]) => k === "stripe_account" && v === "betstreaks_test")));
});
Deno.test("sandbox subscription without user metadata resolves only the sandbox customer", async () => {
  const db = billingDatabase({ ...seed, stripe_account_customers: [
    ...seed.stripe_account_customers,
    { user_id: "user_a", stripe_account: "betstreaks_test", stripe_customer_id: "cus_sandbox" },
  ] });
  const ev = event("customer.subscription.updated");
  delete (ev.data.object.metadata as Partial<typeof ev.data.object.metadata>).user_id;
  assertEquals((await (await deliver(db, ev)).json()).action, "sandbox_customer_recorded");
  assertEquals(db.rpcCalls, []);
});
Deno.test("late sandbox event after test-mode switch-off stays isolated", async () => {
  const db = billingDatabase(seed);
  const response = await deliver(db, event(), { changes: { STRIPE_TEST_MODE: "false" } });
  assertEquals(response.status, 200);
  assertEquals(db.writes[0].row.stripe_account, "betstreaks_test");
  assertEquals(db.rpcCalls, []);
});
Deno.test("live event keeps live customer mapping and Weekly Pass grant while test mode is on", async () => {
  const db = billingDatabase(seed);
  const ev = event(); ev.livemode = true; ev.data.object.livemode = true;
  ev.data.object.customer = "cus_live";
  ev.data.object.id = "cs_live_newWeekly";
  const response = await deliver(db, ev, { secret: billingEnv.STRIPE_BETSTREAKS_WEBHOOK_SECRET });
  assertEquals(response.status, 200);
  assertEquals((await response.json()).action, "granted_weekly_pass");
  assertEquals(db.rpcCalls, ["grant_weekly_pass"]);
  assertEquals(db.writes[0].row.stripe_account, "betstreaks");
});
Deno.test("sandbox metadata cannot route a verified live event into sandbox storage", async () => {
  const db = billingDatabase(seed);
  const ev = event(); ev.livemode = true; ev.data.object.livemode = true;
  ev.data.object.metadata.stripe_account = "betstreaks_test";
  const response = await deliver(db, ev, { secret: billingEnv.STRIPE_BETSTREAKS_WEBHOOK_SECRET });
  assertEquals(response.status, 200);
  assertEquals(db.writes[0].row.stripe_account, "betstreaks");
});
for (const mismatch of ["test-event-live-secret", "live-event-test-secret", "tampered", "missing-test-key", "missing-test-webhook"]) {
  Deno.test(`invalid webhook rejected without database access: ${mismatch}`, async () => {
    const db = billingDatabase(seed);
    const ev = event();
    if (mismatch === "live-event-test-secret") ev.livemode = true;
    const response = await deliver(db, ev, {
      secret: mismatch === "test-event-live-secret" ? billingEnv.STRIPE_BETSTREAKS_WEBHOOK_SECRET : undefined,
      tamper: mismatch === "tampered",
      changes: mismatch === "missing-test-key" ? { STRIPE_TEST_SECRET_KEY: undefined }
        : mismatch === "missing-test-webhook" ? { STRIPE_TEST_WEBHOOK_SECRET: undefined } : {},
    });
    assertEquals(response.status, 400);
    assertEquals(db.writes.length + db.reads.length + db.rpcCalls.length, 0);
  });
}
Deno.test("sandbox invoice failure cannot revoke live premium", async () => {
  const db = billingDatabase(seed);
  assertEquals((await deliver(db, event("invoice.payment_failed"))).status, 200);
  assertEquals(db.writes.length + db.reads.length + db.rpcCalls.length, 0);
});
Deno.test("customer persistence failure returns retryable webhook error", async () => {
  const db = billingDatabase(seed); db.fail("write");
  assertEquals((await deliver(db, event())).status, 500);
  assertEquals(db.rows, seed);
});

Deno.test("sandbox subscription rows cannot preserve premium after live cancellation", async () => {
  const db = billingDatabase({ ...seed, stripe_account_subscriptions: [
    ...seed.stripe_account_subscriptions,
    { user_id: "user_a", stripe_account: "betstreaks_test", stripe_subscription_id: "sub_sandbox", status: "active" },
  ] });
  const ev = event("customer.subscription.deleted", "monthly");
  ev.livemode = true; ev.data.object.livemode = true;
  ev.data.object.id = "sub_live"; ev.data.object.customer = "cus_live"; ev.data.object.status = "canceled";
  const response = await deliver(db, ev, { secret: billingEnv.STRIPE_BETSTREAKS_WEBHOOK_SECRET });
  assertEquals(response.status, 200);
  assertEquals((await response.json()).action, "revoked_premium");
  assertEquals(db.rows.user_flags[0].is_premium, false);
  assertEquals(db.rows.stripe_account_subscriptions[1].status, "active");
});
