-- ============================================================
-- REVIEW COPY — NOT APPLIED.
-- Staged Stripe account migration: additive only.
--
-- Guarantees:
--   * No existing table's columns, primary keys, or constraints are changed.
--   * No existing row is deleted, and no premium access is removed.
--   * All legacy read/write paths (stripe_customers.single() by user_id,
--     stripe_subscriptions upsert on stripe_subscription_id) keep working
--     byte-for-byte as they do today.
--   * New-account state lives in brand-new tables that nothing reads until
--     STRIPE_BETSTREAKS_ACTIVE is turned on.
-- ============================================================

-- Before/after counts are emitted by the verification block at the bottom.

-- ── 1. New account-scoped customer mapping ──────────────────
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
-- No insert/update/delete policies: writes are service-role only, matching
-- the existing stripe_customers table.

-- ── 2. New account-scoped subscription mirror ───────────────
CREATE TABLE IF NOT EXISTS public.stripe_account_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_account text NOT NULL,
  stripe_subscription_id text NOT NULL,
  status text,
  price_id text,
  current_period_end timestamptz,
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

-- ── 3. Entitlement protection flags (additive columns only) ──
-- Adding nullable-with-default columns does not alter any key, constraint or
-- existing query plan; every current SELECT/UPSERT keeps working unchanged.
ALTER TABLE public.user_flags
  ADD COLUMN IF NOT EXISTS is_lifetime boolean NOT NULL DEFAULT false;

ALTER TABLE public.user_flags
  ADD COLUMN IF NOT EXISTS manual_premium boolean NOT NULL DEFAULT false;

ALTER TABLE public.user_flags
  ADD COLUMN IF NOT EXISTS premium_protected_at timestamptz;

-- ── 4. Evidence-based protection backfill ───────────────────
-- Evidence used: a user is premium today but has NO subscription in any
-- account that is currently active or trialing. Their access therefore comes
-- from a lifetime purchase or a manual grant — an old canceled, incomplete or
-- expired subscription row does NOT disqualify them.
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

-- ── 5. Verification (before/after) ──────────────────────────
-- Run these alongside the migration to confirm nothing was lost.
--
--   SELECT count(*) AS premium_users FROM public.user_flags WHERE is_premium;
--       expected: 7 before, 7 after
--   SELECT count(*) AS protected FROM public.user_flags
--       WHERE is_premium AND (is_lifetime OR manual_premium);
--       expected: 0 before, 7 after
--   SELECT count(*) FROM public.stripe_customers;       -- expected: 10, unchanged
--   SELECT count(*) FROM public.stripe_subscriptions;   -- expected: 7,  unchanged
--   SELECT count(*) FROM public.stripe_subscriptions
--       WHERE status IN ('active','trialing');          -- expected: 1,  unchanged

-- ── Rollback ────────────────────────────────────────────────
-- DROP TABLE IF EXISTS public.stripe_account_subscriptions;
-- DROP TABLE IF EXISTS public.stripe_account_customers;
-- ALTER TABLE public.user_flags DROP COLUMN IF EXISTS premium_protected_at;
-- ALTER TABLE public.user_flags DROP COLUMN IF EXISTS manual_premium;
-- ALTER TABLE public.user_flags DROP COLUMN IF EXISTS is_lifetime;
-- (No data loss: these objects hold only migration-era state.)
