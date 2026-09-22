import type { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

type Row = Record<string, unknown>;

/** In-memory PostgREST adapter: filters and conflict keys actually affect rows. */
export function billingDatabase(seed: Record<string, Row[]> = {}) {
  const rows = structuredClone(seed);
  const reads: Array<{ table: string; filters: Array<[string, unknown]> }> = [];
  const writes: Array<{ table: string; row: Row }> = [];
  const rpcCalls: string[] = [];
  let failure: "read" | "write" | null = null;
  const client = {
    auth: { getUser: () => Promise.resolve({ data: { user: { id: "user_a", email: "test@example.com" } }, error: null }) },
    rpc: (name: string) => {
      rpcCalls.push(name);
      return Promise.resolve({ data: "2027-01-01T00:00:00Z", error: null });
    },
    from: (table: string) => {
      const filters: Array<[string, unknown]> = [];
      let single = false;
      let payload: Row | undefined;
      let conflict: string[] = [];
      const execute = () => {
        if (failure === (payload ? "write" : "read")) return { data: null, error: { message: "fixture database failure" } };
        if (payload) {
          writes.push({ table, row: payload });
          const records = rows[table] ??= [];
          const index = records.findIndex((r) => conflict.every((key) => r[key] === payload![key]));
          if (index === -1) records.push(payload);
          else records[index] = { ...records[index], ...payload };
          return { data: null, error: null };
        }
        reads.push({ table, filters: [...filters] });
        const matching = (rows[table] ?? []).filter((row) => filters.every(([key, value]) =>
          Array.isArray(value) ? value.includes(row[key]) : row[key] === value));
        return { data: single ? matching[0] ?? null : matching, error: null };
      };
      const query = {
        select: (_columns: string) => query,
        eq: (column: string, value: unknown) => { filters.push([column, value]); return query; },
        in: (column: string, values: unknown[]) => { filters.push([column, values]); return query; },
        limit: (_count: number) => query,
        maybeSingle: () => { single = true; return Promise.resolve(execute()); },
        upsert: (row: Row, options: { onConflict: string }) => {
          payload = row; conflict = options.onConflict.split(","); return query;
        },
        then: (resolve: (value: ReturnType<typeof execute>) => unknown) => Promise.resolve(execute()).then(resolve),
      };
      return query;
    },
  };
  return {
    rows, reads, writes, rpcCalls,
    fail: (operation: "read" | "write") => { failure = operation; },
    createClient: (() => client) as unknown as typeof createClient,
  };
}

// Deliberately fake, non-credential fixture values only.
export const billingEnv: Record<string, string> = {
  SUPABASE_URL: "https://fixture.invalid",
  SUPABASE_SERVICE_ROLE_KEY: "fixture-service-role",
  SUPABASE_ANON_KEY: "fixture-anon",
  STRIPE_TEST_MODE: "true",
  STRIPE_TEST_SECRET_KEY: "sk_test_fixture",
  STRIPE_TEST_WEBHOOK_SECRET: "whsec_sandboxFixture",
  STRIPE_TEST_PRICE_WEEKLY_PASS: "price_testWeekly",
  STRIPE_BETSTREAKS_ACTIVE: "true",
  STRIPE_BETSTREAKS_SECRET_KEY: "sk_live_fixture",
  STRIPE_BETSTREAKS_WEBHOOK_SECRET: "whsec_liveFixture",
  STRIPE_BETSTREAKS_PRICE_WEEKLY_PASS: "price_liveWeekly",
  STRIPE_BETSTREAKS_PRICE_MONTHLY: "price_liveMonthly",
  STRIPE_BETSTREAKS_PRICE_YEARLY: "price_liveYearly",
  STRIPE_BETSTREAKS_PRICE_LIFETIME: "price_liveLifetime",
  STRIPE_BETSTREAKS_PRICE_ALL_APPS_LIFETIME: "price_liveAllApps",
  STRIPE_SECRET_KEY: "sk_live_legacyFixture",
  STRIPE_WEBHOOK_SECRET: "whsec_legacyFixture",
  STRIPE_PRICE_BETSTREAKS_MONTHLY_1750: "price_legacyMonthly",
};
export const envReader = (changes: Record<string, string | undefined> = {}) => {
  const values = { ...billingEnv, ...changes };
  return (key: string) => values[key];
};

export async function signEvent(payload: string, secret = billingEnv.STRIPE_TEST_WEBHOOK_SECRET) {
  const timestamp = Math.floor(Date.now() / 1000);
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = await crypto.subtle.sign("HMAC", key, encoder.encode(`${timestamp}.${payload}`));
  const signature = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `t=${timestamp},v1=${signature}`;
}
