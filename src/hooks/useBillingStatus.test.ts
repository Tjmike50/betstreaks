import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useBillingStatus } from "./useBillingStatus";

const fixture = vi.hoisted(() => ({ rows: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getUser: async () => ({ data: { user: { id: "billing-test-user" } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
    from: (table: string) => {
      const result = () => ({ data: fixture.rows[table] ?? null });
      const query = {
        select: () => query,
        eq: () => query,
        maybeSingle: async () => result(),
        then: (resolve: (value: ReturnType<typeof result>) => unknown) => Promise.resolve(result()).then(resolve),
      };
      return query;
    },
  },
}));

beforeEach(() => { fixture.rows = {}; });
afterEach(cleanup);

describe("billing controls across Stripe accounts", () => {
  it.each([
    ["legacy", "stripe_customers", "stripe_subscriptions"],
    ["BetStreaks", "stripe_account_customers", "stripe_account_subscriptions"],
  ])("shows subscription management for a %s subscriber", async (_account, customers, subscriptions) => {
    fixture.rows[customers] = { stripe_customer_id: "cus_billing_test" };
    fixture.rows[subscriptions] = [{ status: "active" }];
    const { result } = renderHook(() => useBillingStatus(true, false));
    await waitFor(() => expect(result.current.state).toBe("active_subscription"));
    expect(result.current.hasCustomer).toBe(true);
  });

  it("recognizes a new-account lifetime buyer", async () => {
    fixture.rows.stripe_account_customers = { stripe_customer_id: "cus_lifetime_test" };
    const { result } = renderHook(() => useBillingStatus(true, false));
    await waitFor(() => expect(result.current.state).toBe("lifetime"));
    expect(result.current.hasActiveSubscription).toBe(false);
  });

  it("preserves premium without billing records", async () => {
    const { result } = renderHook(() => useBillingStatus(true, false));
    await waitFor(() => expect(result.current.state).toBe("premium_no_billing"));
  });
});


describe("prepaid pass billing status", () => {
  it("does not label a weekly buyer as lifetime", async () => {
    fixture.rows.stripe_account_customers = { stripe_customer_id: "cus_weekly" };
    const expiry = new Date(Date.now() + 9 * 7 * 86400000).toISOString();
    const { result } = renderHook(() => useBillingStatus(true, false, expiry, false));
    await waitFor(() => expect(result.current.state).toBe("weekly_pass"));
  });
  it("preserves lifetime status with an expired weekly pass", async () => {
    fixture.rows.stripe_account_customers = { stripe_customer_id: "cus_lifetime" };
    const { result } = renderHook(() => useBillingStatus(true, false, "2020-01-01T00:00:00Z", true));
    await waitFor(() => expect(result.current.state).toBe("lifetime"));
  });
  it("shows no subscription after prepaid access expires", async () => {
    fixture.rows.stripe_account_customers = { stripe_customer_id: "cus_weekly" };
    const { result } = renderHook(() => useBillingStatus(false, false, "2020-01-01T00:00:00Z", false));
    await waitFor(() => expect(result.current.state).toBe("no_subscription"));
  });
});
