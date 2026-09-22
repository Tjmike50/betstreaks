import { assertEquals, assert } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";
import { handleCheckoutRequest } from "./handler.ts";
import { billingDatabase, billingEnv, envReader } from "../_shared/testing/billingFixtures.ts";

function fixture(options: {
  changes?: Record<string, string | undefined>;
  seed?: Record<string, Record<string, unknown>[]>;
  foundCustomer?: string;
  price?: Record<string, unknown>;
  session?: Record<string, unknown>;
  stripeError?: unknown;
} = {}) {
  const database = billingDatabase(options.seed ?? {
    stripe_account_customers: [{ user_id: "user_a", stripe_account: "betstreaks", stripe_customer_id: "cus_live" }],
  });
  const sessions: Array<Record<string, unknown>> = [];
  const customerCreates: Array<Record<string, unknown>> = [];
  const customerSearches: Array<Record<string, unknown>> = [];
  const keys: string[] = [];
  const priceIds: string[] = [];
  const subscriptions: Array<Record<string, unknown>> = [];
  const env = envReader(options.changes);
  const isTest = env("STRIPE_TEST_MODE") === "true";
  const stripe = {
    prices: { retrieve: (id: string) => {
      priceIds.push(id);
      if (options.stripeError) throw options.stripeError;
      return Promise.resolve({ active: true, livemode: !isTest, type: "one_time", currency: "usd", unit_amount: 500, ...options.price });
    } },
    customers: {
      list: (params: Record<string, unknown>) => {
        customerSearches.push(params);
        return Promise.resolve({ data: options.foundCustomer ? [{ id: options.foundCustomer }] : [] });
      },
      create: (params: Record<string, unknown>) => {
        customerCreates.push(params); return Promise.resolve({ id: "cus_sandbox" });
      },
    },
    subscriptions: { list: (params: Record<string, unknown>) => { subscriptions.push(params); return Promise.resolve({ data: [] }); } },
    checkout: { sessions: { create: (params: Record<string, unknown>) => {
      sessions.push(params);
      return Promise.resolve({ id: isTest ? "cs_test_fixture" : "cs_live_fixture", livemode: !isTest, url: "https://checkout.stripe.com/fixture", ...options.session });
    } } },
  };
  return {
    ...database, sessions, customerCreates, customerSearches, keys, priceIds, subscriptions,
    request: (plan = "weekly_pass", weeks: unknown = 9) => handleCheckoutRequest(new Request("https://fixture.invalid/checkout", {
      method: "POST",
      headers: { Authorization: "Bearer fixture-token", Origin: "https://betstreaks.example", "Content-Type": "application/json" },
      body: JSON.stringify({ plan, weeks, allowPromoCodes: true }),
    }), {
      env, createClient: database.createClient,
      createStripe: (key) => { keys.push(key); return stripe as unknown as Stripe; },
    }),
  };
}

Deno.test("sandbox ignores live mapping, creates and persists its own customer, then reuses it", async () => {
  const f = fixture();
  assertEquals((await f.request()).status, 200);
  assertEquals(f.keys, [billingEnv.STRIPE_TEST_SECRET_KEY]);
  assertEquals(f.sessions[0].customer, "cus_sandbox");
  assertEquals(f.rows.stripe_account_customers.map((r) => [r.stripe_account, r.stripe_customer_id]), [
    ["betstreaks", "cus_live"], ["betstreaks_test", "cus_sandbox"],
  ]);
  assertEquals(f.customerCreates[0].metadata, { user_id: "user_a", stripe_account: "betstreaks_test" });
  assertEquals((await f.request()).status, 200);
  assertEquals(f.sessions[1].customer, "cus_sandbox");
  assertEquals(f.customerCreates.length, 1);
  assertEquals(f.customerSearches.length, 1);
  assert(f.writes.every((w) => w.table === "stripe_account_customers" && w.row.stripe_account === "betstreaks_test"));
});

Deno.test("sandbox reuses email match from the selected test client and leaves live customer alone", async () => {
  const f = fixture({ foundCustomer: "cus_existingSandbox" });
  assertEquals((await f.request()).status, 200);
  assertEquals(f.sessions[0].customer, "cus_existingSandbox");
  assertEquals(f.customerCreates.length, 0);
  assertEquals(f.rows.stripe_account_customers[0].stripe_customer_id, "cus_live");
  assertEquals(f.rows.stripe_account_customers[1].stripe_account, "betstreaks_test");
  assertEquals(f.keys, [billingEnv.STRIPE_TEST_SECRET_KEY]);
});

Deno.test("existing sandbox mapping is reused without email lookup or creation", async () => {
  const f = fixture({ seed: { stripe_account_customers: [
    { user_id: "user_a", stripe_account: "betstreaks", stripe_customer_id: "cus_live" },
    { user_id: "user_a", stripe_account: "betstreaks_test", stripe_customer_id: "cus_existingSandbox" },
  ] } });
  assertEquals((await f.request()).status, 200);
  assertEquals(f.sessions[0].customer, "cus_existingSandbox");
  assertEquals(f.customerCreates.length + f.customerSearches.length + f.writes.length, 0);
});

for (const changes of [
  { STRIPE_TEST_SECRET_KEY: undefined }, { STRIPE_TEST_SECRET_KEY: "sk_live_fixture" },
  { STRIPE_TEST_SECRET_KEY: "garbage" }, { STRIPE_TEST_SECRET_KEY: "sk_test_" },
  { STRIPE_TEST_WEBHOOK_SECRET: undefined }, { STRIPE_TEST_WEBHOOK_SECRET: "invalid" },
  { STRIPE_TEST_PRICE_WEEKLY_PASS: undefined }, { STRIPE_TEST_PRICE_WEEKLY_PASS: "prod_wrong" },
  { STRIPE_TEST_PRICE_WEEKLY_PASS: "price_" },
]) {
  Deno.test(`test mode fails closed for invalid ${Object.keys(changes)[0]} (${Object.values(changes)[0] ?? "missing"})`, async () => {
    const f = fixture({ changes });
    const response = await f.request();
    assertEquals(response.status, 503);
    assertEquals((await response.json()).code, "test_config_invalid");
    assertEquals(f.keys.length + f.sessions.length + f.writes.length, 0);
  });
}

Deno.test("test mode with an unconfigured other plan never uses a live price", async () => {
  const f = fixture();
  assertEquals((await f.request("monthly")).status, 503);
  assertEquals(f.keys.length, 0);
});

Deno.test("disabled test mode reuses live BetStreaks mapping and live weekly price", async () => {
  const f = fixture({ changes: { STRIPE_TEST_MODE: "false", STRIPE_TEST_SECRET_KEY: undefined } });
  assertEquals((await f.request()).status, 200);
  assertEquals(f.sessions[0].customer, "cus_live");
  assertEquals(f.priceIds, ["price_liveWeekly"]);
  assertEquals(f.keys, [billingEnv.STRIPE_BETSTREAKS_SECRET_KEY]);
  assertEquals(f.writes.length + f.customerSearches.length + f.customerCreates.length, 0);
});

Deno.test("disabled test mode preserves legacy subscription checkout", async () => {
  const f = fixture({ changes: { STRIPE_TEST_MODE: "false", STRIPE_BETSTREAKS_ACTIVE: "false" }, seed: {
    stripe_customers: [{ user_id: "user_a", stripe_customer_id: "cus_legacy" }],
  } });
  assertEquals((await f.request("monthly")).status, 200);
  assertEquals(f.sessions[0].customer, "cus_legacy");
  assertEquals(f.sessions[0].line_items, [{ price: "price_legacyMonthly", quantity: 1 }]);
  assertEquals(f.sessions[0].mode, "subscription");
  assertEquals(f.keys, [billingEnv.STRIPE_SECRET_KEY]);
});

for (const weeks of [1, 9, 43, 520]) {
  Deno.test(`Weekly Pass keeps one-time $5 price, ${weeks} quantity and existing redirects`, async () => {
    const f = fixture();
    assertEquals((await f.request("weekly_pass", weeks)).status, 200);
    const session = f.sessions[0];
    assertEquals(session.line_items, [{ price: "price_testWeekly", quantity: weeks }]);
    assertEquals(session.mode, "payment");
    assertEquals(session.success_url, "https://betstreaks.example/premium?success=1&weekly_session={CHECKOUT_SESSION_ID}");
    assertEquals(session.cancel_url, "https://betstreaks.example/premium?canceled=1");
    assertEquals(session.allow_promotion_codes, undefined);
    assertEquals(session.metadata, { user_id: "user_a", plan: "weekly_pass", product: "betstreaks", stripe_account: "betstreaks_test", weeks: String(weeks) });
  });
}
for (const price of [{ unit_amount: 499 }, { currency: "eur" }, { type: "recurring" }, { active: false }, { livemode: true }]) {
  Deno.test(`rejects incompatible sandbox price: ${Object.keys(price)[0]}`, async () => {
    const f = fixture({ price });
    assertEquals((await f.request()).status, 400);
    assertEquals(f.sessions.length + f.customerCreates.length, 0);
  });
}
for (const weeks of [0, 521, 1.5, "9"]) {
  Deno.test(`rejects invalid weeks ${JSON.stringify(weeks)} before Stripe access`, async () => {
    const f = fixture();
    assertEquals((await f.request("weekly_pass", weeks)).status, 400);
    assertEquals(f.keys.length, 0);
  });
}
for (const operation of ["read", "write"] as const) {
  Deno.test(`customer ${operation} failure prevents checkout creation`, async () => {
    const f = fixture(); f.fail(operation);
    assertEquals((await f.request()).status, 400);
    assertEquals(f.sessions.length, 0);
    assertEquals(f.rows.stripe_account_customers.length, 1);
  });
}
Deno.test("does not return a live session from a sandbox checkout", async () => {
  const f = fixture({ session: { livemode: true, id: "cs_live_wrong" } });
  const response = await f.request();
  assertEquals(response.status, 502);
  assertEquals((await response.json()).url, undefined);
});
Deno.test("raw Stripe authentication errors never appear in response or logs", async () => {
  const sentinel = "fixture-sensitive-value";
  const f = fixture({ stripeError: { type: "StripeAuthenticationError", code: "api_key_expired", message: `Invalid API key: ${sentinel}` } });
  const logs: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => { logs.push(JSON.stringify(args)); };
  try {
    const response = await f.request();
    assertEquals(response.status, 400);
    assert(!(await response.text()).includes(sentinel));
    assert(!logs.join("").includes(sentinel));
  } finally { console.error = original; }
});

Deno.test("sandbox subscription checkout ignores live subscriptions and uses only the sandbox customer", async () => {
  const f = fixture({
    changes: { STRIPE_TEST_PRICE_MONTHLY: "price_testMonthly" }, price: { type: "recurring" },
    seed: {
      stripe_account_customers: [{ user_id: "user_a", stripe_account: "betstreaks", stripe_customer_id: "cus_live" }],
      stripe_account_subscriptions: [{ user_id: "user_a", stripe_account: "betstreaks", status: "active" }],
      stripe_subscriptions: [{ user_id: "user_a", status: "active" }],
    },
  });
  assertEquals((await f.request("monthly")).status, 200);
  assertEquals(f.sessions[0].customer, "cus_sandbox");
  assertEquals(f.sessions[0].line_items, [{ price: "price_testMonthly", quantity: 1 }]);
  assertEquals(f.subscriptions[0].customer, "cus_sandbox");
  assert(!f.reads.some((r) => r.table.includes("subscriptions")));
});
Deno.test("sandbox subscription rows cannot block a new live subscription", async () => {
  const f = fixture({ changes: { STRIPE_TEST_MODE: "false" }, seed: {
    stripe_account_customers: [{ user_id: "user_a", stripe_account: "betstreaks", stripe_customer_id: "cus_live" }],
    stripe_account_subscriptions: [{ user_id: "user_a", stripe_account: "betstreaks_test", status: "active" }],
  } });
  assertEquals((await f.request("monthly")).status, 200);
  assertEquals(f.sessions[0].customer, "cus_live");
});
Deno.test("live duplicate subscription protection remains active", async () => {
  const f = fixture({ changes: { STRIPE_TEST_MODE: "false" }, seed: {
    stripe_account_subscriptions: [{ user_id: "user_a", stripe_account: "betstreaks", status: "active" }],
  } });
  const response = await f.request("monthly");
  assertEquals(response.status, 400);
  assertEquals((await response.json()).code, "already_subscribed");
  assertEquals(f.sessions.length, 0);
});
