
-- Delete stale line_snapshots stamped as 2026-04-01 for teams playing on 2026-04-02
-- These were created before the commence_time game_date fix
DELETE FROM line_snapshots
WHERE game_date = '2026-04-01'
  AND player_name IN (
    SELECT DISTINCT ls.player_name
    FROM line_snapshots ls
    JOIN (SELECT DISTINCT player_name, team_abbr FROM player_recent_games) pt
      ON lower(trim(ls.player_name)) = lower(trim(pt.player_name))
    WHERE ls.game_date = '2026-04-01'
      AND pt.team_abbr NOT IN (
        SELECT home_team_abbr FROM games_today WHERE game_date = '2026-04-01' AND sport = 'NBA' AND home_team_abbr IS NOT NULL
        UNION
        SELECT away_team_abbr FROM games_today WHERE game_date = '2026-04-01' AND sport = 'NBA' AND away_team_abbr IS NOT NULL
      )
  );
