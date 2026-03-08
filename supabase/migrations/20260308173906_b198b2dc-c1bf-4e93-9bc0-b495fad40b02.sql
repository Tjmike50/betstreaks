
-- Player prop scoring cache: stores computed analytics for each player/stat/date
CREATE TABLE public.player_prop_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_date date NOT NULL DEFAULT CURRENT_DATE,
  player_id bigint NOT NULL,
  player_name text NOT NULL,
  team_abbr text,
  opponent_abbr text,
  home_away text, -- 'home' or 'away'
  stat_type text NOT NULL, -- 'pts', 'reb', 'ast', 'fg3m', 'stl', 'blk'
  threshold numeric NOT NULL, -- the prop line to score against

  -- Rolling averages
  last3_avg numeric,
  last5_avg numeric,
  last10_avg numeric,
  last15_avg numeric,
  season_avg numeric,

  -- Hit rates against threshold
  last5_hit_rate numeric,
  last10_hit_rate numeric,
  last15_hit_rate numeric,
  season_hit_rate numeric,
  total_games integer DEFAULT 0,

  -- Opponent-specific
  vs_opponent_avg numeric,
  vs_opponent_hit_rate numeric,
  vs_opponent_games integer DEFAULT 0,

  -- Home/Away splits
  home_avg numeric,
  away_avg numeric,
  home_hit_rate numeric,
  away_hit_rate numeric,
  home_games integer DEFAULT 0,
  away_games integer DEFAULT 0,

  -- Derived scores (0-100)
  confidence_score numeric,
  value_score numeric,
  volatility_score numeric,
  consistency_score numeric,

  -- Metadata
  reason_tags jsonb DEFAULT '[]'::jsonb,
  scored_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE(game_date, player_id, stat_type, threshold)
);

-- RLS: public read, service role write
ALTER TABLE public.player_prop_scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read prop scores" ON public.player_prop_scores
  FOR SELECT USING (true);

-- Index for fast lookups
CREATE INDEX idx_prop_scores_date ON public.player_prop_scores(game_date);
CREATE INDEX idx_prop_scores_player ON public.player_prop_scores(player_id, stat_type);
CREATE INDEX idx_prop_scores_confidence ON public.player_prop_scores(game_date, confidence_score DESC NULLS LAST);
