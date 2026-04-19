-- Add sport-awareness and idempotency to ai_daily_picks
ALTER TABLE public.ai_daily_picks
  ADD COLUMN IF NOT EXISTS sport TEXT NOT NULL DEFAULT 'NBA',
  ADD COLUMN IF NOT EXISTS generation_source TEXT NOT NULL DEFAULT 'auto';

-- Backfill defensive (table may already be empty)
UPDATE public.ai_daily_picks SET sport = 'NBA' WHERE sport IS NULL;

-- Idempotency: at most one daily pick per (sport, pick_date)
CREATE UNIQUE INDEX IF NOT EXISTS ai_daily_picks_sport_date_key
  ON public.ai_daily_picks (sport, pick_date);
