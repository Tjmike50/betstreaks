
-- Scoring weights config table for safe, reversible weight adjustments
CREATE TABLE public.scoring_weights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version integer NOT NULL DEFAULT 1,
  is_active boolean NOT NULL DEFAULT false,
  label text NOT NULL DEFAULT 'default',
  notes text,
  weights jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text DEFAULT 'system'
);

-- Ensure only one active weight set
CREATE UNIQUE INDEX idx_scoring_weights_active ON public.scoring_weights (is_active) WHERE is_active = true;

ALTER TABLE public.scoring_weights ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins read scoring weights" ON public.scoring_weights
  FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));

-- Insert default weights matching current engine
INSERT INTO public.scoring_weights (version, is_active, label, notes, weights) VALUES (
  1, true, 'v1-baseline',
  'Original hardcoded weights from scoring engine',
  '{
    "recent": 0.21,
    "season": 0.12,
    "trend": 0.12,
    "opponent": 0.09,
    "venue": 0.08,
    "rest": 0.06,
    "defense": 0.09,
    "consistency": 0.05,
    "teammate": 0.07,
    "minutes": 0.05,
    "market": 0.06
  }'::jsonb
);

-- Factor performance snapshot table for analysis results
CREATE TABLE public.factor_analysis_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_date date NOT NULL DEFAULT CURRENT_DATE,
  lookback_days integer NOT NULL DEFAULT 30,
  sample_size integer NOT NULL DEFAULT 0,
  factor_performance jsonb NOT NULL DEFAULT '{}'::jsonb,
  score_range_performance jsonb NOT NULL DEFAULT '{}'::jsonb,
  overstatement_analysis jsonb NOT NULL DEFAULT '{}'::jsonb,
  recommendations jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(analysis_date, lookback_days)
);

ALTER TABLE public.factor_analysis_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins read factor analysis" ON public.factor_analysis_snapshots
  FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));
