-- Add MLB v1 anchor scoring axes to shared player_prop_scores table.
-- Backward compatible: all columns nullable, no defaults that change existing rows.

ALTER TABLE public.player_prop_scores
  ADD COLUMN IF NOT EXISTS score_overall numeric,
  ADD COLUMN IF NOT EXISTS score_recent_form numeric,
  ADD COLUMN IF NOT EXISTS score_matchup numeric,
  ADD COLUMN IF NOT EXISTS score_opportunity numeric,
  ADD COLUMN IF NOT EXISTS score_consistency numeric,
  ADD COLUMN IF NOT EXISTS score_value numeric,
  ADD COLUMN IF NOT EXISTS score_risk numeric,
  ADD COLUMN IF NOT EXISTS confidence_tier text,
  ADD COLUMN IF NOT EXISTS summary_json jsonb;

-- Index to speed up "top scored props by sport+date".
CREATE INDEX IF NOT EXISTS idx_pps_sport_game_date_score
  ON public.player_prop_scores (sport, game_date, score_overall DESC);
