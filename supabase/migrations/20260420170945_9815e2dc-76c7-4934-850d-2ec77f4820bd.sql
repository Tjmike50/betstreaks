-- 1) Delete stale orphan MLB games_today rows (hex IDs, no abbrs).
DELETE FROM public.games_today
WHERE sport = 'MLB' AND home_team_abbr IS NULL AND away_team_abbr IS NULL;

-- 2) Backfill team_abbr / opponent_abbr / home_away on today's MLB scored rows.
WITH ctx AS (
  SELECT
    c.game_id,
    (c.game_context_json->>'home_team_id')::bigint AS home_team_id,
    (c.game_context_json->>'away_team_id')::bigint AS away_team_id,
    g.home_team_abbr,
    g.away_team_abbr
  FROM public.mlb_game_context c
  JOIN public.games_today g
    ON g.id = c.game_id AND g.sport = 'MLB' AND g.game_date = CURRENT_DATE
  WHERE g.home_team_abbr IS NOT NULL AND g.away_team_abbr IS NOT NULL
),
resolved AS (
  SELECT
    pps.id,
    CASE
      WHEN p.mlb_team_id = ctx.home_team_id THEN ctx.home_team_abbr
      WHEN p.mlb_team_id = ctx.away_team_id THEN ctx.away_team_abbr
    END AS team_abbr,
    CASE
      WHEN p.mlb_team_id = ctx.home_team_id THEN ctx.away_team_abbr
      WHEN p.mlb_team_id = ctx.away_team_id THEN ctx.home_team_abbr
    END AS opponent_abbr,
    CASE
      WHEN p.mlb_team_id = ctx.home_team_id THEN 'home'
      WHEN p.mlb_team_id = ctx.away_team_id THEN 'away'
    END AS home_away
  FROM public.player_prop_scores pps
  JOIN public.mlb_player_profiles p ON p.player_id = pps.player_id
  JOIN ctx ON p.mlb_team_id IN (ctx.home_team_id, ctx.away_team_id)
  WHERE pps.sport = 'MLB' AND pps.game_date = CURRENT_DATE
)
UPDATE public.player_prop_scores pps
SET team_abbr = r.team_abbr,
    opponent_abbr = r.opponent_abbr,
    home_away = r.home_away
FROM resolved r
WHERE pps.id = r.id AND r.team_abbr IS NOT NULL;