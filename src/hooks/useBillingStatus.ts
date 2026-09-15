import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type BillingState =
  | "loading"
  | "no_user"
  | "no_subscription"      // not premium, no customer
  | "active_subscription"  // premium + active monthly/yearly
  | "weekly_pass"
  | "lifetime"             // premium + has a stripe customer but no active sub (one-time paid)
  | "premium_no_billing";  // premium flag true but no stripe customer at all

interface BillingStatus {
  state: BillingState;
  hasCustomer: boolean;
  hasActiveSubscription: boolean;
  isLoading: boolean;
}

const ACTIVE_STATUSES = ["active", "trialing", "past_due"];

export function useBillingStatus(isPremium: boolean, isPremiumLoading: boolean, weeklyExpiresAt: string | null = null, basePremium = false): BillingStatus {
  const [hasCustomer, setHasCustomer] = useState(false);
  const [hasActiveSubscription, setHasActiveSubscription] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [hasUser, setHasUser] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function check() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!mounted) return;
      if (!user) {
        setHasUser(false);
        setHasCustomer(false);
        setHasActiveSubscription(false);
        setIsLoading(false);
        return;
      }
      setHasUser(true);

      const [legacyCustomer, legacySubscriptions, accountCustomer, accountSubscriptions] = await Promise.all([
        supabase
          .from("stripe_customers")
          .select("stripe_customer_id")
          .eq("user_id", user.id)
          .maybeSingle(),
        supabase
          .from("stripe_subscriptions")
          .select("status")
          .eq("user_id", user.id),
        supabase
          .from("stripe_account_customers")
          .select("stripe_customer_id")
          .eq("user_id", user.id)
          .eq("stripe_account", "betstreaks")
          .maybeSingle(),
        supabase
          .from("stripe_account_subscriptions")
          .select("status")
          .eq("user_id", user.id)
          .eq("stripe_account", "betstreaks"),
      ]);

      if (!mounted) return;
      setHasCustomer(Boolean(
        legacyCustomer.data?.stripe_customer_id || accountCustomer.data?.stripe_customer_id
      ));
      const subs = [...(legacySubscriptions.data ?? []), ...(accountSubscriptions.data ?? [])];
      setHasActiveSubscription(
        Array.isArray(subs) && subs.some((s) => ACTIVE_STATUSES.includes(s.status as string))
      );
      setIsLoading(false);
    }

    check();
    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => { queueMicrotask(() => void check()); });
    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const loading = isLoading || isPremiumLoading;

  let state: BillingState = "loading";
  if (!loading) {
    if (!hasUser) state = "no_user";
    else if (isPremium && hasActiveSubscription) state = "active_subscription";
    else if (isPremium && !basePremium && weeklyExpiresAt && Date.parse(weeklyExpiresAt) > Date.now()) state = "weekly_pass";
    else if (isPremium && hasCustomer) state = "lifetime";
    else if (isPremium && !hasCustomer) state = "premium_no_billing";
    else state = "no_subscription";
  }

  return { state, hasCustomer, hasActiveSubscription, isLoading: loading };
}
