
-- Daily evaluation snapshots for trend tracking
CREATE TABLE IF NOT EXISTS public.eval_daily_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_date date NOT NULL UNIQUE,
  prop_total integer NOT NULL DEFAULT 0,
  prop_hits integer NOT NULL DEFAULT 0,
  prop_hit_rate numeric,
  slip_total integer NOT NULL DEFAULT 0,
  slip_hits integer NOT NULL DEFAULT 0,
  slip_hit_rate numeric,
  confidence_buckets jsonb DEFAULT '{}',
  value_buckets jsonb DEFAULT '{}',
  stat_type_buckets jsonb DEFAULT '{}',
  risk_label_buckets jsonb DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.eval_daily_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins read eval snapshots"
  ON public.eval_daily_snapshots FOR SELECT
  USING (public.is_admin(auth.uid()));

-- Enable extensions for cron scheduling
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
