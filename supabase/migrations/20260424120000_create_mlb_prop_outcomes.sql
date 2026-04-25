CREATE TABLE public.mlb_prop_outcomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_prop_score_id uuid NOT NULL,
  sport text NOT NULL DEFAULT 'MLB',
  game_date date NOT NULL,
  player_id bigint NOT NULL,
  player_name text,
  team_abbr text,
  opponent_abbr text,
  stat_type text NOT NULL,
  threshold numeric,
  pick_side text NOT NULL DEFAULT 'over',
  actual_value numeric,
  outcome text NOT NULL DEFAULT 'pending' CHECK (outcome IN ('hit', 'miss', 'push', 'pending', 'void')),
  graded_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL DEFAULT 'grade-mlb-props',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (player_prop_score_id)
);

ALTER TABLE public.mlb_prop_outcomes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read mlb prop outcomes"
  ON public.mlb_prop_outcomes FOR SELECT
  USING (true);

CREATE POLICY "service role write mlb prop outcomes"
  ON public.mlb_prop_outcomes
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

CREATE TRIGGER trg_mlb_prop_outcomes_updated_at
  BEFORE UPDATE ON public.mlb_prop_outcomes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX idx_mlb_prop_outcomes_game_date ON public.mlb_prop_outcomes(game_date);
CREATE INDEX idx_mlb_prop_outcomes_stat_type ON public.mlb_prop_outcomes(stat_type);
CREATE INDEX idx_mlb_prop_outcomes_player_id ON public.mlb_prop_outcomes(player_id);
