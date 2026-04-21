-- Remove only clearly unusable orphaned rows
DELETE FROM public.games_today
WHERE home_team_abbr IS NULL
  AND away_team_abbr IS NULL
  AND canonical_game_key IS NULL;

-- Now safe to create the unique dedup index
CREATE UNIQUE INDEX IF NOT EXISTS idx_games_today_canonical_key
  ON public.games_today (canonical_game_key)
  WHERE canonical_game_key IS NOT NULL;