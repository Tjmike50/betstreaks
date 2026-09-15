-- ── 1. Account-scoped customer mapping (new table) ──
CREATE TABLE IF NOT EXISTS public.stripe_account_customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_account text NOT NULL,
  stripe_customer_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stripe_account_customers_user_account_key UNIQUE (user_id, stripe_account),
  CONSTRAINT stripe_account_customers_account_customer_key UNIQUE (stripe_account, stripe_customer_id)
);

GRANT SELECT ON public.stripe_account_customers TO authenticated;
GRANT ALL ON public.stripe_account_customers TO service_role;

ALTER TABLE public.stripe_account_customers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own account customers" ON public.stripe_account_customers;
CREATE POLICY "Users read own account customers"
  ON public.stripe_account_customers
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- ── 2. Account-scoped subscription mirror (new table) ──
CREATE TABLE IF NOT EXISTS public.stripe_account_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_account text NOT NULL,
  stripe_subscription_id text NOT NULL,
  status text,
  price_id text,
  current_period_end timestamptz,
  last_event_id text,
  last_event_created_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stripe_account_subscriptions_account_sub_key UNIQUE (stripe_account, stripe_subscription_id)
);

CREATE INDEX IF NOT EXISTS stripe_account_subscriptions_user_idx
  ON public.stripe_account_subscriptions (user_id, stripe_account);

GRANT SELECT ON public.stripe_account_subscriptions TO authenticated;
GRANT ALL ON public.stripe_account_subscriptions TO service_role;

ALTER TABLE public.stripe_account_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own account subscriptions" ON public.stripe_account_subscriptions;
CREATE POLICY "Users read own account subscriptions"
  ON public.stripe_account_subscriptions
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- ── 3. Entitlement protection flags (additive columns) ──
ALTER TABLE public.user_flags
  ADD COLUMN IF NOT EXISTS is_lifetime boolean NOT NULL DEFAULT false;

ALTER TABLE public.user_flags
  ADD COLUMN IF NOT EXISTS manual_premium boolean NOT NULL DEFAULT false;

ALTER TABLE public.user_flags
  ADD COLUMN IF NOT EXISTS premium_protected_at timestamptz;

-- ── 4. Stale/out-of-order event guard on the legacy mirror (additive) ──
ALTER TABLE public.stripe_subscriptions
  ADD COLUMN IF NOT EXISTS last_event_id text;

ALTER TABLE public.stripe_subscriptions
  ADD COLUMN IF NOT EXISTS last_event_created_at timestamptz;

-- ── 5. Evidence-based protection backfill ──
-- A member is protected when they are premium today and have no active or
-- trialing subscription anywhere. Old cancelled/incomplete/expired rows do not
-- disqualify them: their access comes from a lifetime purchase or manual grant.
UPDATE public.user_flags f
SET manual_premium = true,
    premium_protected_at = COALESCE(f.premium_protected_at, now())
WHERE f.is_premium = true
  AND f.manual_premium = false
  AND f.is_lifetime = false
  AND NOT EXISTS (
    SELECT 1
    FROM public.stripe_subscriptions s
    WHERE s.user_id = f.user_id
      AND s.status IN ('active', 'trialing')
  );