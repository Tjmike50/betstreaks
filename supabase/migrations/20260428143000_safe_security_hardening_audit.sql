-- Safe, idempotent security hardening audit migration
-- ---------------------------------------------------
-- This migration is intentionally additive and defensive:
-- - enables RLS only on tables that are currently likely unprotected
-- - preserves public read access required by the production frontend
-- - keeps sensitive operational/provider tables admin-only
-- - keeps Edge Function service-role access working
-- - avoids temporary/debug objects such as public.tmp_strikeouts_before
-- - does NOT apply any destructive privilege changes outside the audited scope

-- 1) Enable RLS on tables that should not be left fully open.
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'public.backend_alerts',
    'public.events',
    'public.market_outcomes',
    'public.market_snapshots',
    'public.markets',
    'public.mlb_player_aliases',
    'public.mlb_refresh_health',
    'public.mlb_team_id_map',
    'public.mlb_team_id_map_backup_20260424',
    'public.mlb_unresolved_players',
    'public.nba_players_staging',
    'public.odds_raw_responses',
    'public.odds_source_runs',
    'public.player_aliases',
    'public.players',
    'public.sportsbooks',
    'public.streaks',
    'public.teams',
    'public.unmatched_props_queue',
    'public.user_flags'
  ]
  LOOP
    EXECUTE format('ALTER TABLE IF EXISTS %s ENABLE ROW LEVEL SECURITY', tbl);
  END LOOP;
END $$;

-- 2) Preserve public read access for production frontend data sources.
DO $$
BEGIN
  IF to_regclass('public.teams') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_policies
       WHERE schemaname = 'public' AND tablename = 'teams' AND policyname = 'public read teams'
     ) THEN
    EXECUTE 'CREATE POLICY "public read teams" ON public.teams FOR SELECT TO anon, authenticated USING (true)';
  END IF;

  IF to_regclass('public.players') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_policies
       WHERE schemaname = 'public' AND tablename = 'players' AND policyname = 'public read players'
     ) THEN
    EXECUTE 'CREATE POLICY "public read players" ON public.players FOR SELECT TO anon, authenticated USING (true)';
  END IF;

  IF to_regclass('public.sportsbooks') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_policies
       WHERE schemaname = 'public' AND tablename = 'sportsbooks' AND policyname = 'public read sportsbooks'
     ) THEN
    EXECUTE 'CREATE POLICY "public read sportsbooks" ON public.sportsbooks FOR SELECT TO anon, authenticated USING (true)';
  END IF;

  IF to_regclass('public.events') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_policies
       WHERE schemaname = 'public' AND tablename = 'events' AND policyname = 'public read events'
     ) THEN
    EXECUTE 'CREATE POLICY "public read events" ON public.events FOR SELECT TO anon, authenticated USING (true)';
  END IF;

  IF to_regclass('public.markets') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_policies
       WHERE schemaname = 'public' AND tablename = 'markets' AND policyname = 'public read markets'
     ) THEN
    EXECUTE 'CREATE POLICY "public read markets" ON public.markets FOR SELECT TO anon, authenticated USING (true)';
  END IF;

  IF to_regclass('public.market_outcomes') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_policies
       WHERE schemaname = 'public' AND tablename = 'market_outcomes' AND policyname = 'public read market_outcomes'
     ) THEN
    EXECUTE 'CREATE POLICY "public read market_outcomes" ON public.market_outcomes FOR SELECT TO anon, authenticated USING (true)';
  END IF;

  IF to_regclass('public.market_snapshots') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_policies
       WHERE schemaname = 'public' AND tablename = 'market_snapshots' AND policyname = 'public read market_snapshots'
     ) THEN
    EXECUTE 'CREATE POLICY "public read market_snapshots" ON public.market_snapshots FOR SELECT TO anon, authenticated USING (true)';
  END IF;

  IF to_regclass('public.streaks') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_policies
       WHERE schemaname = 'public' AND tablename = 'streaks' AND policyname = 'public read streaks'
     ) THEN
    EXECUTE 'CREATE POLICY "public read streaks" ON public.streaks FOR SELECT TO anon, authenticated USING (true)';
  END IF;

  -- Existing production tables that frontend pages read directly.
  IF to_regclass('public.games_today') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_policies
       WHERE schemaname = 'public' AND tablename = 'games_today' AND policyname = 'Public read access'
     ) THEN
    EXECUTE 'CREATE POLICY "Public read access" ON public.games_today FOR SELECT TO anon, authenticated USING (true)';
  END IF;

  IF to_regclass('public.player_prop_scores') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_policies
       WHERE schemaname = 'public' AND tablename = 'player_prop_scores' AND policyname = 'public read prop scores'
     ) THEN
    EXECUTE 'CREATE POLICY "public read prop scores" ON public.player_prop_scores FOR SELECT TO anon, authenticated USING (true)';
  END IF;

  IF to_regclass('public.line_snapshots') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_policies
       WHERE schemaname = 'public' AND tablename = 'line_snapshots' AND policyname = 'public read line snapshots'
     ) THEN
    EXECUTE 'CREATE POLICY "public read line snapshots" ON public.line_snapshots FOR SELECT TO anon, authenticated USING (true)';
  END IF;

  IF to_regclass('public.streak_events') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_policies
       WHERE schemaname = 'public' AND tablename = 'streak_events' AND policyname = 'Public read access'
     ) THEN
    EXECUTE 'CREATE POLICY "Public read access" ON public.streak_events FOR SELECT TO anon, authenticated USING (true)';
  END IF;

  IF to_regclass('public.ai_daily_picks') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_policies
       WHERE schemaname = 'public' AND tablename = 'ai_daily_picks' AND policyname = 'public read daily picks'
     ) THEN
    EXECUTE 'CREATE POLICY "public read daily picks" ON public.ai_daily_picks FOR SELECT TO anon, authenticated USING (true)';
  END IF;

  IF to_regclass('public.ai_daily_pick_legs') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_policies
       WHERE schemaname = 'public' AND tablename = 'ai_daily_pick_legs' AND policyname = 'public read daily pick legs'
     ) THEN
    EXECUTE 'CREATE POLICY "public read daily pick legs" ON public.ai_daily_pick_legs FOR SELECT TO anon, authenticated USING (true)';
  END IF;

  IF to_regclass('public.refresh_status') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_policies
       WHERE schemaname = 'public' AND tablename = 'refresh_status' AND policyname = 'Public read access'
     ) THEN
    EXECUTE 'CREATE POLICY "Public read access" ON public.refresh_status FOR SELECT TO anon, authenticated USING (true)';
  END IF;

  -- Premium/admin checks must still work from the frontend.
  IF to_regclass('public.user_flags') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_policies
       WHERE schemaname = 'public' AND tablename = 'user_flags' AND policyname = 'authenticated read own flags'
     ) THEN
    EXECUTE 'CREATE POLICY "authenticated read own flags" ON public.user_flags FOR SELECT TO authenticated USING (user_id = auth.uid())';
  END IF;
END $$;

-- 3) Restrict operational/provider tables to admins only.
DO $$
BEGIN
  IF to_regclass('public.odds_raw_responses') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_policies
       WHERE schemaname = 'public' AND tablename = 'odds_raw_responses' AND policyname = 'admins read odds_raw_responses'
     ) THEN
    EXECUTE 'CREATE POLICY "admins read odds_raw_responses" ON public.odds_raw_responses FOR SELECT TO authenticated USING (public.is_admin(auth.uid()))';
  END IF;

  IF to_regclass('public.odds_source_runs') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_policies
       WHERE schemaname = 'public' AND tablename = 'odds_source_runs' AND policyname = 'admins read odds_source_runs'
     ) THEN
    EXECUTE 'CREATE POLICY "admins read odds_source_runs" ON public.odds_source_runs FOR SELECT TO authenticated USING (public.is_admin(auth.uid()))';
  END IF;

  IF to_regclass('public.backend_alerts') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_policies
       WHERE schemaname = 'public' AND tablename = 'backend_alerts' AND policyname = 'admins read backend_alerts'
     ) THEN
    EXECUTE 'CREATE POLICY "admins read backend_alerts" ON public.backend_alerts FOR SELECT TO authenticated USING (public.is_admin(auth.uid()))';
  END IF;

  IF to_regclass('public.mlb_refresh_health') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_policies
       WHERE schemaname = 'public' AND tablename = 'mlb_refresh_health' AND policyname = 'admins read mlb_refresh_health'
     ) THEN
    EXECUTE 'CREATE POLICY "admins read mlb_refresh_health" ON public.mlb_refresh_health FOR SELECT TO authenticated USING (public.is_admin(auth.uid()))';
  END IF;

  IF to_regclass('public.mlb_unresolved_players') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_policies
       WHERE schemaname = 'public' AND tablename = 'mlb_unresolved_players' AND policyname = 'admins read mlb_unresolved_players'
     ) THEN
    EXECUTE 'CREATE POLICY "admins read mlb_unresolved_players" ON public.mlb_unresolved_players FOR SELECT TO authenticated USING (public.is_admin(auth.uid()))';
  END IF;

  IF to_regclass('public.mlb_player_aliases') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_policies
       WHERE schemaname = 'public' AND tablename = 'mlb_player_aliases' AND policyname = 'admins read mlb_player_aliases'
     ) THEN
    EXECUTE 'CREATE POLICY "admins read mlb_player_aliases" ON public.mlb_player_aliases FOR SELECT TO authenticated USING (public.is_admin(auth.uid()))';
  END IF;

  IF to_regclass('public.mlb_team_id_map') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_policies
       WHERE schemaname = 'public' AND tablename = 'mlb_team_id_map' AND policyname = 'admins read mlb_team_id_map'
     ) THEN
    EXECUTE 'CREATE POLICY "admins read mlb_team_id_map" ON public.mlb_team_id_map FOR SELECT TO authenticated USING (public.is_admin(auth.uid()))';
  END IF;

  IF to_regclass('public.player_aliases') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_policies
       WHERE schemaname = 'public' AND tablename = 'player_aliases' AND policyname = 'admins read player_aliases'
     ) THEN
    EXECUTE 'CREATE POLICY "admins read player_aliases" ON public.player_aliases FOR SELECT TO authenticated USING (public.is_admin(auth.uid()))';
  END IF;

  IF to_regclass('public.unmatched_props_queue') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_policies
       WHERE schemaname = 'public' AND tablename = 'unmatched_props_queue' AND policyname = 'admins read unmatched_props_queue'
     ) THEN
    EXECUTE 'CREATE POLICY "admins read unmatched_props_queue" ON public.unmatched_props_queue FOR SELECT TO authenticated USING (public.is_admin(auth.uid()))';
  END IF;

  IF to_regclass('public.nba_players_staging') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_policies
       WHERE schemaname = 'public' AND tablename = 'nba_players_staging' AND policyname = 'admins read nba_players_staging'
     ) THEN
    EXECUTE 'CREATE POLICY "admins read nba_players_staging" ON public.nba_players_staging FOR SELECT TO authenticated USING (public.is_admin(auth.uid()))';
  END IF;
END $$;

-- 4) Defense-in-depth: authenticated/anon users must not write privilege flags.
ALTER TABLE IF EXISTS public.user_flags ENABLE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE ON public.user_flags FROM anon, authenticated;

-- 5) Make user-facing views respect caller permissions.
DO $$
DECLARE
  view_name text;
BEGIN
  FOREACH view_name IN ARRAY ARRAY[
    'best_available_lines',
    'consensus_lines',
    'player_market_board',
    'line_movement_summary',
    'odds_admin_status',
    'games_today_trusted',
    'games_today_trusted_et'
  ]
  LOOP
    IF EXISTS (
      SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname = view_name
        AND c.relkind = 'v'
    ) THEN
      EXECUTE format('ALTER VIEW public.%I SET (security_invoker = on)', view_name);
    END IF;
  END LOOP;
END $$;

-- 6) Lock down the SECURITY DEFINER MLB resolver function without breaking Edge Functions.
DO $$
BEGIN
  IF to_regprocedure('public.resolve_mlb_player_for_odds(text,text,text,text,text,text)') IS NOT NULL THEN
    EXECUTE 'ALTER FUNCTION public.resolve_mlb_player_for_odds(text, text, text, text, text, text) SET search_path = public';
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.resolve_mlb_player_for_odds(text, text, text, text, text, text) FROM PUBLIC, anon, authenticated';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.resolve_mlb_player_for_odds(text, text, text, text, text, text) TO service_role';
  END IF;
END $$;
