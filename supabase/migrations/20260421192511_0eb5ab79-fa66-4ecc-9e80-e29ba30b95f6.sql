ALTER TABLE public.games_today
  ADD COLUMN IF NOT EXISTS source_primary text NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS source_secondary text,
  ADD COLUMN IF NOT EXISTS last_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS verification_status text NOT NULL DEFAULT 'unverified',
  ADD COLUMN IF NOT EXISTS schedule_confidence integer NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS is_postponed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS canonical_game_key text,
  ADD COLUMN IF NOT EXISTS mismatch_flags jsonb NOT NULL DEFAULT '[]'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'games_today_verification_status_check'
  ) THEN
    ALTER TABLE public.games_today
      ADD CONSTRAINT games_today_verification_status_check
      CHECK (verification_status IN ('verified','unverified','mismatch','missing_secondary'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'games_today_schedule_confidence_check'
  ) THEN
    ALTER TABLE public.games_today
      ADD CONSTRAINT games_today_schedule_confidence_check
      CHECK (schedule_confidence BETWEEN 0 AND 100);
  END IF;
END $$;

-- Backfill canonical_game_key only for rows with both teams present
UPDATE public.games_today
SET canonical_game_key =
  sport || '_' || game_date::text || '_' || away_team_abbr || '_' || home_team_abbr
WHERE canonical_game_key IS NULL
  AND away_team_abbr IS NOT NULL
  AND home_team_abbr IS NOT NULL;

-- Composite index for slate queries
CREATE INDEX IF NOT EXISTS idx_games_today_verification
  ON public.games_today (sport, game_date, verification_status, is_active);