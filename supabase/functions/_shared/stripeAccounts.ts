// ============================================================
// Dual Stripe account support (staged migration).
//
// "legacy"     — the original Stripe account. Credentials:
//                STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET and the
//                STRIPE_PRICE_* price IDs. Untouched by this migration.
// "betstreaks" — the new account acct_1UG1iXAHW2dqNeWS. Credentials:
//                STRIPE_BETSTREAKS_SECRET_KEY / STRIPE_BETSTREAKS_WEBHOOK_SECRET
//                and the STRIPE_BETSTREAKS_PRICE_* price IDs.
//
// New checkouts only move to "betstreaks" when STRIPE_BETSTREAKS_ACTIVE === "true"
// AND every required new-account value is present. Anything missing => stay on
// legacy (fail safe, never fail open).
//
// Storage is additive: legacy rows continue to live in stripe_customers /
// stripe_subscriptions; new-account rows live in stripe_account_customers /
// stripe_account_subscriptions. No existing table's shape or keys change.
// ============================================================

export type StripeAccountId = "legacy" | "betstreaks";

export type StandardPlanKey = "monthly" | "yearly" | "lifetime" | "all_apps_lifetime";
export type PlanKey = StandardPlanKey | "weekly_pass";

export const PLAN_MODES: Record<PlanKey, "subscription" | "payment"> = {
  weekly_pass: "payment",
  monthly: "subscription",
  yearly: "subscription",
  lifetime: "payment",
  all_apps_lifetime: "payment",
};

export const PLAN_LABELS: Record<PlanKey, string> = {
  weekly_pass: "BetStreaks Weekly Pass",
  monthly: "Premium Monthly",
  yearly: "Premium Yearly",
  lifetime: "BetStreaks Lifetime",
  all_apps_lifetime: "All Apps Lifetime Pass",
};

export const PLAN_PRODUCTS: Record<PlanKey, "betstreaks" | "all_apps"> = {
  weekly_pass: "betstreaks",
  monthly: "betstreaks",
  yearly: "betstreaks",
  lifetime: "betstreaks",
  all_apps_lifetime: "all_apps",
};

export const LEGACY_PRICE_ENV: Record<StandardPlanKey, string> = {
  monthly: "STRIPE_PRICE_BETSTREAKS_MONTHLY_1750",
  yearly: "STRIPE_PRICE_BETSTREAKS_YEARLY_180",
  lifetime: "STRIPE_PRICE_BETSTREAKS_LIFETIME_480",
  all_apps_lifetime: "STRIPE_PRICE_ALL_APPS_LIFETIME_2750",
};

export const BETSTREAKS_PRICE_ENV: Record<PlanKey, string> = {
  weekly_pass: "STRIPE_BETSTREAKS_PRICE_WEEKLY_PASS",
  monthly: "STRIPE_BETSTREAKS_PRICE_MONTHLY",
  yearly: "STRIPE_BETSTREAKS_PRICE_YEARLY",
  lifetime: "STRIPE_BETSTREAKS_PRICE_LIFETIME",
  all_apps_lifetime: "STRIPE_BETSTREAKS_PRICE_ALL_APPS_LIFETIME",
};

// ── Sandbox / test mode ──
// Temporary end-to-end testing against Stripe test mode. Enabled only when
// STRIPE_TEST_MODE === "true" AND STRIPE_TEST_SECRET_KEY is a real sk_test_ key.
// Live credentials are never read or modified while this is on.
export const TEST_MODE_ENV = "STRIPE_TEST_MODE";
export const TEST_SECRET_KEY_ENV = "STRIPE_TEST_SECRET_KEY";
export const TEST_WEBHOOK_SECRET_ENV = "STRIPE_TEST_WEBHOOK_SECRET";

export const TEST_PRICE_ENV: Record<PlanKey, string> = {
  weekly_pass: "STRIPE_TEST_PRICE_WEEKLY_PASS",
  monthly: "STRIPE_TEST_PRICE_MONTHLY",
  yearly: "STRIPE_TEST_PRICE_YEARLY",
  lifetime: "STRIPE_TEST_PRICE_LIFETIME",
  all_apps_lifetime: "STRIPE_TEST_PRICE_ALL_APPS_LIFETIME",
};

export const BETSTREAKS_SECRET_KEY_ENV = "STRIPE_BETSTREAKS_SECRET_KEY";
export const BETSTREAKS_WEBHOOK_SECRET_ENV = "STRIPE_BETSTREAKS_WEBHOOK_SECRET";
export const BETSTREAKS_ACTIVE_ENV = "STRIPE_BETSTREAKS_ACTIVE";

export type EnvReader = (key: string) => string | undefined;

export interface AccountConfig {
  id: StripeAccountId;
  secretKey: string;
  webhookSecret: string | null;
  prices: Partial<Record<PlanKey, string>>;
  customersTable: string;
  subscriptionsTable: string;
}

export interface AccountTables {
  customersTable: string;
  subscriptionsTable: string;
}

export function tablesForAccount(id: StripeAccountId): AccountTables {
  return id === "legacy"
    ? { customersTable: "stripe_customers", subscriptionsTable: "stripe_subscriptions" }
    : {
        customersTable: "stripe_account_customers",
        subscriptionsTable: "stripe_account_subscriptions",
      };
}

function readPrices(env: EnvReader, map: Partial<Record<PlanKey, string>>) {
  const prices: Partial<Record<PlanKey, string>> = {};
  for (const plan of Object.keys(map) as PlanKey[]) {
    const value = env(map[plan]!)?.trim();
    if (value && value.startsWith("price_")) prices[plan] = value;
  }
  return prices;
}

export function loadLegacyAccount(env: EnvReader): AccountConfig | null {
  const secretKey = env("STRIPE_SECRET_KEY")?.trim();
  if (!secretKey) return null;
  return {
    id: "legacy",
    secretKey,
    webhookSecret: env("STRIPE_WEBHOOK_SECRET")?.trim() || null,
    prices: readPrices(env, LEGACY_PRICE_ENV),
    ...tablesForAccount("legacy"),
  };
}

export function loadBetstreaksAccount(env: EnvReader): AccountConfig | null {
  const secretKey = env(BETSTREAKS_SECRET_KEY_ENV)?.trim();
  if (!secretKey) return null;
  return {
    id: "betstreaks",
    secretKey,
    webhookSecret: env(BETSTREAKS_WEBHOOK_SECRET_ENV)?.trim() || null,
    prices: readPrices(env, BETSTREAKS_PRICE_ENV),
    ...tablesForAccount("betstreaks"),
  };
}

export interface ActivationState {
  active: boolean;
  /** Machine-readable reason. Never contains secret values. */
  reason:
    | "active"
    | "switch_off"
    | "missing_secret_key"
    | "missing_webhook_secret"
    | "missing_prices";
  missingPlans: PlanKey[];
}

/**
 * The new account is only used for new checkouts when the switch is explicitly
 * on AND the configuration is complete. Anything else keeps us on legacy.
 */
export function betstreaksActivation(env: EnvReader): ActivationState {
  const switchOn = (env(BETSTREAKS_ACTIVE_ENV) ?? "").trim().toLowerCase() === "true";
  if (!switchOn) return { active: false, reason: "switch_off", missingPlans: [] };

  const account = loadBetstreaksAccount(env);
  if (!account) {
    return { active: false, reason: "missing_secret_key", missingPlans: [] };
  }
  if (!account.webhookSecret) {
    return { active: false, reason: "missing_webhook_secret", missingPlans: [] };
  }
  const missingPlans = (Object.keys(LEGACY_PRICE_ENV) as PlanKey[]).filter(
    (plan) => !account.prices[plan],
  );
  if (missingPlans.length > 0) {
    return { active: false, reason: "missing_prices", missingPlans };
  }
  return { active: true, reason: "active", missingPlans: [] };
}

export interface CheckoutAccountSelection {
  account: AccountConfig | null;
  activation: ActivationState;
  /** Safe to log: no secret material. */
  diagnostics: Record<string, unknown>;
}

export function testModeEnabled(env: EnvReader): boolean {
  return (env(TEST_MODE_ENV) ?? "").trim().toLowerCase() === "true";
}

/** Test-mode account. Null unless a genuine sk_test_ key is configured. */
export function loadTestAccount(env: EnvReader): AccountConfig | null {
  const secretKey = env(TEST_SECRET_KEY_ENV)?.trim();
  if (!secretKey || !secretKey.startsWith("sk_test_")) return null;
  return {
    id: "betstreaks",
    secretKey,
    webhookSecret: env(TEST_WEBHOOK_SECRET_ENV)?.trim() || null,
    prices: readPrices(env, TEST_PRICE_ENV),
    ...tablesForAccount("betstreaks"),
  };
}

export function selectCheckoutAccount(env: EnvReader): CheckoutAccountSelection {
  const activation = betstreaksActivation(env);

  if (testModeEnabled(env)) {
    const testAccount = loadTestAccount(env);
    if (testAccount) {
      return {
        account: testAccount,
        activation,
        diagnostics: {
          selectedAccount: testAccount.id,
          testMode: true,
          betstreaksActive: activation.active,
          activationReason: activation.reason,
          missingPlans: activation.missingPlans,
        },
      };
    }
  }

  const account = activation.active ? loadBetstreaksAccount(env) : loadLegacyAccount(env);
  return {
    account,
    activation,
    diagnostics: {
      selectedAccount: account?.id ?? null,
      testMode: false,
      testModeRequested: testModeEnabled(env),
      betstreaksActive: activation.active,
      activationReason: activation.reason,
      missingPlans: activation.missingPlans,
    },
  };
}

export function priceForPlan(account: AccountConfig, plan: PlanKey): string | null {
  return account.prices[plan] ?? null;
}

/**
 * Entitlement safety net. A cancellation in one account must never remove
 * access that comes from a lifetime purchase, a manual grant, or an active
 * subscription living in the *other* account.
 */
export function shouldRevokePremium(input: {
  isLifetime: boolean;
  manualPremium: boolean;
  otherActiveSubscriptionCount: number;
}): boolean {
  if (input.isLifetime) return false;
  if (input.manualPremium) return false;
  if (input.otherActiveSubscriptionCount > 0) return false;
  return true;
}

export const ACTIVE_SUBSCRIPTION_STATUSES = ["active", "trialing"] as const;

export function isActiveSubscriptionStatus(status: string | null | undefined): boolean {
  return (ACTIVE_SUBSCRIPTION_STATUSES as readonly string[]).includes(status ?? "");
}

/**
 * Which account should a billing-portal session be opened against?
 * Prefer the account holding an active subscription; fall back to any account
 * with a subscription record; otherwise nothing to manage.
 */
export function selectPortalAccount(rows: Array<{
  account: StripeAccountId;
  status: string | null;
}>): StripeAccountId | null {
  const active = rows.find((r) => isActiveSubscriptionStatus(r.status));
  if (active) return active.account;
  // Newest account first so a migrated user lands on their current account.
  const betstreaks = rows.find((r) => r.account === "betstreaks");
  if (betstreaks) return "betstreaks";
  const legacy = rows.find((r) => r.account === "legacy");
  return legacy ? "legacy" : null;
}
