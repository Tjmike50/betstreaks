import { assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";
import { handlePortalRequest } from "./handler.ts";
import { billingDatabase, billingEnv, envReader } from "../_shared/testing/billingFixtures.ts";

for (const liveScope of [null, "legacy", "betstreaks"]) {
  Deno.test(`portal ignores sandbox records with live account ${liveScope ?? "absent"}`, async () => {
    const db = billingDatabase({
      stripe_account_subscriptions: [
        { user_id: "user_a", stripe_account: "betstreaks_test", status: "active" },
        ...(liveScope === "betstreaks" ? [{ user_id: "user_a", stripe_account: "betstreaks", status: "active" }] : []),
      ],
      stripe_account_customers: [
        { user_id: "user_a", stripe_account: "betstreaks_test", stripe_customer_id: "cus_sandbox" },
        { user_id: "user_a", stripe_account: "betstreaks", stripe_customer_id: "cus_live" },
      ],
      stripe_subscriptions: liveScope === "legacy" ? [{ user_id: "user_a", status: "active" }] : [],
      stripe_customers: [{ user_id: "user_a", stripe_customer_id: "cus_legacy" }],
    });
    const keys: string[] = [];
    const sessions: Array<Record<string, unknown>> = [];
    const stripe = {
      subscriptions: { list: () => Promise.resolve({ data: [{ id: "sub_live" }] }) },
      billingPortal: { sessions: { create: (params: Record<string, unknown>) => {
        sessions.push(params); return Promise.resolve({ id: "bps_fixture", url: "https://billing.stripe.com/fixture" });
      } } },
    };
    const response = await handlePortalRequest(new Request("https://fixture.invalid/portal", {
      method: "POST", headers: { Authorization: "Bearer fixture-token" },
    }), {
      env: envReader(), createClient: db.createClient,
      createStripe: (key) => { keys.push(key); return stripe as unknown as Stripe; },
    });
    const result = await response.json();
    if (!liveScope) {
      assertEquals(result.code, "no_subscription");
      assertEquals(keys.length + sessions.length, 0);
    } else {
      assertEquals(keys, [liveScope === "legacy" ? billingEnv.STRIPE_SECRET_KEY : billingEnv.STRIPE_BETSTREAKS_SECRET_KEY]);
      assertEquals(sessions[0].customer, liveScope === "legacy" ? "cus_legacy" : "cus_live");
      assertEquals(result.url, "https://billing.stripe.com/fixture");
    }
    assertEquals(db.writes.length, 0);
  });
}
