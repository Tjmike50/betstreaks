
-- Prop outcome tracking: individual prop results
CREATE TABLE public.prop_outcomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_date date NOT NULL,
  player_id bigint NOT NULL,
  player_name text NOT NULL,
  team_abbr text,
  opponent_abbr text,
  home_away text,
  stat_type text NOT NULL,
  threshold numeric NOT NULL,
  confidence_score numeric,
  value_score numeric,
  volatility_score numeric,
  consistency_score numeric,
  line_hit_rate_l10 numeric,
  line_hit_rate_season numeric,
  actual_value numeric,
  hit boolean,
  graded_at timestamptz,
  source text DEFAULT 'scoring_engine',
  reason_tags jsonb DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(game_date, player_id, stat_type, threshold)
);

ALTER TABLE public.prop_outcomes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins read prop outcomes" ON public.prop_outcomes
  FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()));

CREATE POLICY "public read prop outcomes" ON public.prop_outcomes
  FOR SELECT USING (true);

-- Slip outcome tracking: full slip results
CREATE TABLE public.slip_outcomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slip_id uuid REFERENCES public.ai_slips(id) ON DELETE SET NULL,
  slip_name text NOT NULL,
  risk_label text NOT NULL,
  estimated_odds text,
  leg_count integer NOT NULL DEFAULT 0,
  legs_hit integer,
  slip_hit boolean,
  first_failed_leg integer,
  prompt text,
  game_date date NOT NULL DEFAULT CURRENT_DATE,
  graded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.slip_outcomes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read slip outcomes" ON public.slip_outcomes
  FOR SELECT USING (true);

-- Slip leg outcomes for detailed per-leg tracking
CREATE TABLE public.slip_leg_outcomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slip_outcome_id uuid REFERENCES public.slip_outcomes(id) ON DELETE CASCADE NOT NULL,
  leg_order integer NOT NULL DEFAULT 0,
  player_name text NOT NULL,
  team_abbr text,
  stat_type text NOT NULL,
  threshold numeric NOT NULL,
  pick text NOT NULL,
  actual_value numeric,
  hit boolean,
  confidence_score numeric,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.slip_leg_outcomes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read slip leg outcomes" ON public.slip_leg_outcomes
  FOR SELECT USING (true);

-- Indexes for analytics queries
CREATE INDEX idx_prop_outcomes_date ON public.prop_outcomes(game_date);
CREATE INDEX idx_prop_outcomes_confidence ON public.prop_outcomes(confidence_score);
CREATE INDEX idx_prop_outcomes_stat ON public.prop_outcomes(stat_type);
CREATE INDEX idx_slip_outcomes_date ON public.slip_outcomes(game_date);
CREATE INDEX idx_slip_outcomes_risk ON public.slip_outcomes(risk_label);
