import {
  assertEquals,
  assertNotEquals,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import {
  betstreaksActivation,
  loadBetstreaksAccount,
  loadLegacyAccount,
  loadTestAccount,
  priceForPlan,
  selectCheckoutAccount,
  selectPortalAccount,
  shouldRevokePremium,
  tablesForAccount,
  type EnvReader,
} from "../_shared/stripeAccounts.ts";

const LEGACY_ENV: Record<string, string> = {
  STRIPE_SECRET_KEY: "sk_test_legacy",
  STRIPE_WEBHOOK_SECRET: "whsec_legacy",
  STRIPE_PRICE_BETSTREAKS_MONTHLY_1750: "price_legacy_monthly",
  STRIPE_PRICE_BETSTREAKS_YEARLY_180: "price_legacy_yearly",
  STRIPE_PRICE_BETSTREAKS_LIFETIME_480: "price_legacy_lifetime",
  STRIPE_PRICE_ALL_APPS_LIFETIME_2750: "price_legacy_allapps",
};

const NEW_ENV: Record<string, string> = {
  STRIPE_BETSTREAKS_SECRET_KEY: "rk_live_new",
  STRIPE_BETSTREAKS_WEBHOOK_SECRET: "whsec_new",
  STRIPE_BETSTREAKS_PRICE_MONTHLY: "price_1UG21bAHW2dqNeWSUccrYHEv",
  STRIPE_BETSTREAKS_PRICE_YEARLY: "price_1UG21xAHW2dqNeWSjd7M4iCZ",
  STRIPE_BETSTREAKS_PRICE_LIFETIME: "price_1UG22BAHW2dqNeWS2kpJK8US",
  STRIPE_BETSTREAKS_PRICE_ALL_APPS_LIFETIME: "price_1UG22VAHW2dqNeWSnwEWaMTI",
};

function envOf(...maps: Record<string, string>[]): EnvReader {
  const merged = Object.assign({}, ...maps);
  return (key: string) => merged[key];
}

// ── Activation switch ──────────────────────────────────────

Deno.test("switch off keeps new checkouts on the legacy account", () => {
  const env = envOf(LEGACY_ENV, NEW_ENV);
  const state = betstreaksActivation(env);
  assertEquals(state.active, false);
  assertEquals(state.reason, "switch_off");
  assertEquals(selectCheckoutAccount(env).account?.id, "legacy");
});

Deno.test("switch on without a secret key fails safe to legacy", () => {
  const env = envOf(LEGACY_ENV, { STRIPE_BETSTREAKS_ACTIVE: "true" });
  const state = betstreaksActivation(env);
  assertEquals(state.active, false);
  assertEquals(state.reason, "missing_secret_key");
  assertEquals(selectCheckoutAccount(env).account?.id, "legacy");
});

Deno.test("switch on without a webhook secret fails safe to legacy", () => {
  const partial = { ...NEW_ENV };
  delete partial.STRIPE_BETSTREAKS_WEBHOOK_SECRET;
  const env = envOf(LEGACY_ENV, partial, { STRIPE_BETSTREAKS_ACTIVE: "true" });
  const state = betstreaksActivation(env);
  assertEquals(state.active, false);
  assertEquals(state.reason, "missing_webhook_secret");
  assertEquals(selectCheckoutAccount(env).account?.id, "legacy");
});

Deno.test("switch on with an incomplete price set fails safe to legacy", () => {
  const partial = { ...NEW_ENV };
  delete partial.STRIPE_BETSTREAKS_PRICE_ALL_APPS_LIFETIME;
  const env = envOf(LEGACY_ENV, partial, { STRIPE_BETSTREAKS_ACTIVE: "true" });
  const state = betstreaksActivation(env);
  assertEquals(state.active, false);
  assertEquals(state.reason, "missing_prices");
  assertEquals(state.missingPlans, ["all_apps_lifetime"]);
  assertEquals(selectCheckoutAccount(env).account?.id, "legacy");
});

Deno.test("fully configured switch routes new checkouts to the new account", () => {
  const env = envOf(LEGACY_ENV, NEW_ENV, { STRIPE_BETSTREAKS_ACTIVE: "true" });
  const state = betstreaksActivation(env);
  assertEquals(state.active, true);
  const { account } = selectCheckoutAccount(env);
  assertEquals(account?.id, "betstreaks");
  assertEquals(account?.customerScope, "betstreaks");
  assertEquals(priceForPlan(account!, "monthly"), "price_1UG21bAHW2dqNeWSUccrYHEv");
  assertEquals(priceForPlan(account!, "yearly"), "price_1UG21xAHW2dqNeWSjd7M4iCZ");
  assertEquals(priceForPlan(account!, "lifetime"), "price_1UG22BAHW2dqNeWS2kpJK8US");
  assertEquals(
    priceForPlan(account!, "all_apps_lifetime"),
    "price_1UG22VAHW2dqNeWSnwEWaMTI",
  );
});

Deno.test("legacy prices are never served from the new account config", () => {
  const env = envOf(LEGACY_ENV, NEW_ENV, { STRIPE_BETSTREAKS_ACTIVE: "true" });
  const legacy = loadLegacyAccount(env)!;
  const neu = loadBetstreaksAccount(env)!;
  assertEquals(legacy.customerScope, "legacy");
  assertNotEquals(priceForPlan(legacy, "monthly"), priceForPlan(neu, "monthly"));
  assertEquals(priceForPlan(legacy, "monthly"), "price_legacy_monthly");
});

Deno.test("malformed price values are rejected rather than sent to Stripe", () => {
  const env = envOf(LEGACY_ENV, NEW_ENV, {
    STRIPE_BETSTREAKS_PRICE_MONTHLY: "prod_VGZ9iHm7C1kyoJ",
    STRIPE_BETSTREAKS_ACTIVE: "true",
  });
  const state = betstreaksActivation(env);
  assertEquals(state.active, false);
  assertEquals(state.missingPlans, ["monthly"]);
});

// ── Storage routing (cross-account id safety) ──────────────

Deno.test("each account reads and writes its own tables", () => {
  assertEquals(tablesForAccount("legacy"), {
    customersTable: "stripe_customers",
    subscriptionsTable: "stripe_subscriptions",
  });
  assertEquals(tablesForAccount("betstreaks"), {
    customersTable: "stripe_account_customers",
    subscriptionsTable: "stripe_account_subscriptions",
  });
});

// ── Portal routing ─────────────────────────────────────────

Deno.test("existing legacy subscriber is sent to the legacy portal", () => {
  assertEquals(
    selectPortalAccount([{ account: "legacy", status: "active" }]),
    "legacy",
  );
});

Deno.test("active subscription wins over a stale record in the other account", () => {
  assertEquals(
    selectPortalAccount([
      { account: "legacy", status: "canceled" },
      { account: "betstreaks", status: "active" },
    ]),
    "betstreaks",
  );
  assertEquals(
    selectPortalAccount([
      { account: "betstreaks", status: "incomplete_expired" },
      { account: "legacy", status: "trialing" },
    ]),
    "legacy",
  );
});

Deno.test("no subscription anywhere means no portal", () => {
  assertEquals(selectPortalAccount([]), null);
});

// ── Entitlement preservation ───────────────────────────────

Deno.test("lifetime buyers are never downgraded by a cancellation", () => {
  assertEquals(
    shouldRevokePremium({
      isLifetime: true,
      manualPremium: false,
      otherActiveSubscriptionCount: 0,
    }),
    false,
  );
});

Deno.test("manually granted premium is never downgraded", () => {
  assertEquals(
    shouldRevokePremium({
      isLifetime: false,
      manualPremium: true,
      otherActiveSubscriptionCount: 0,
    }),
    false,
  );
});

Deno.test("an active subscription in the other account blocks downgrade", () => {
  assertEquals(
    shouldRevokePremium({
      isLifetime: false,
      manualPremium: false,
      otherActiveSubscriptionCount: 1,
    }),
    false,
  );
});

Deno.test("a plain subscriber with nothing else does get downgraded", () => {
  assertEquals(
    shouldRevokePremium({
      isLifetime: false,
      manualPremium: false,
      otherActiveSubscriptionCount: 0,
    }),
    true,
  );
});

Deno.test("test configuration selects an isolated scope without reading live credentials", () => {
  const values: Record<string, string> = {
    STRIPE_TEST_MODE: "true",
    STRIPE_TEST_SECRET_KEY: "sk_test_fixture",
    STRIPE_TEST_WEBHOOK_SECRET: "whsec_fixture",
    STRIPE_TEST_PRICE_WEEKLY_PASS: "price_fixture",
  };
  const env: EnvReader = (key) => {
    if (!key.startsWith("STRIPE_TEST_")) throw new Error("Must not read live configuration");
    return values[key];
  };
  const { account, diagnostics } = selectCheckoutAccount(env);
  assertEquals(account?.customerScope, "betstreaks_test");
  assertEquals(account?.id, "betstreaks");
  assertEquals(account?.secretKey, values.STRIPE_TEST_SECRET_KEY);
  assertEquals(account?.prices.weekly_pass, "price_fixture");
  assertEquals(diagnostics.testMode, true);
  assertEquals(loadTestAccount(env)?.customerScope, "betstreaks_test");
});
