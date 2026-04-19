-- Add sport columns to existing tables (default to NBA to preserve current data)
ALTER TABLE public.ai_slips
  ADD COLUMN IF NOT EXISTS sport text NOT NULL DEFAULT 'NBA';

ALTER TABLE public.saved_slips
  ADD COLUMN IF NOT EXISTS sport text NOT NULL DEFAULT 'NBA';

ALTER TABLE public.player_prop_scores
  ADD COLUMN IF NOT EXISTS sport text NOT NULL DEFAULT 'NBA';

ALTER TABLE public.favorite_players
  ADD COLUMN IF NOT EXISTS sport text NOT NULL DEFAULT 'NBA';

-- Indexes for sport-filtered queries
CREATE INDEX IF NOT EXISTS idx_ai_slips_sport ON public.ai_slips(sport);
CREATE INDEX IF NOT EXISTS idx_saved_slips_sport ON public.saved_slips(sport);
CREATE INDEX IF NOT EXISTS idx_player_prop_scores_sport_date
  ON public.player_prop_scores(sport, game_date);
CREATE INDEX IF NOT EXISTS idx_favorite_players_user_sport
  ON public.favorite_players(user_id, sport);

-- ============================================================
-- ai_player_insights: cached AI research blurbs per player/day
-- ============================================================
CREATE TABLE IF NOT EXISTS public.ai_player_insights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sport text NOT NULL DEFAULT 'NBA',
  player_id bigint NOT NULL,
  player_name text NOT NULL,
  insight_date date NOT NULL DEFAULT CURRENT_DATE,
  summary text NOT NULL,
  key_points jsonb NOT NULL DEFAULT '[]'::jsonb,
  confidence numeric,
  model text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sport, player_id, insight_date)
);

CREATE INDEX IF NOT EXISTS idx_ai_player_insights_lookup
  ON public.ai_player_insights(sport, player_id, insight_date DESC);

ALTER TABLE public.ai_player_insights ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read ai player insights"
  ON public.ai_player_insights FOR SELECT
  USING (true);

CREATE TRIGGER ai_player_insights_set_updated_at
  BEFORE UPDATE ON public.ai_player_insights
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- cheatsheet_cache: pre-computed cheatsheet payloads per module
-- ============================================================
CREATE TABLE IF NOT EXISTS public.cheatsheet_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sport text NOT NULL DEFAULT 'NBA',
  module text NOT NULL,
  scope_date date NOT NULL DEFAULT CURRENT_DATE,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '1 hour'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sport, module, scope_date)
);

CREATE INDEX IF NOT EXISTS idx_cheatsheet_cache_lookup
  ON public.cheatsheet_cache(sport, module, scope_date DESC);

ALTER TABLE public.cheatsheet_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read cheatsheet cache"
  ON public.cheatsheet_cache FOR SELECT
  USING (true);

CREATE TRIGGER cheatsheet_cache_set_updated_at
  BEFORE UPDATE ON public.cheatsheet_cache
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();