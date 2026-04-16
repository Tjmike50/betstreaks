
-- Create odds_cache table
CREATE TABLE public.odds_cache (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  sport_key text NOT NULL,
  event_id text NOT NULL,
  market_key text NOT NULL,
  bookmaker_key text NOT NULL DEFAULT 'consensus',
  home_team text NOT NULL,
  away_team text NOT NULL,
  commence_time timestamptz,
  odds_data jsonb NOT NULL DEFAULT '[]'::jsonb,
  provider text NOT NULL DEFAULT 'the-odds-api',
  fetched_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '5 minutes'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Composite index for cache lookups
CREATE INDEX idx_odds_cache_lookup ON public.odds_cache (sport_key, event_id, market_key, bookmaker_key);

-- Index for expiration checks
CREATE INDEX idx_odds_cache_expires ON public.odds_cache (expires_at);

-- Unique constraint for upserts
CREATE UNIQUE INDEX idx_odds_cache_unique ON public.odds_cache (sport_key, event_id, market_key, bookmaker_key);

-- Enable RLS
ALTER TABLE public.odds_cache ENABLE ROW LEVEL SECURITY;

-- Public read access
CREATE POLICY "public read odds cache"
  ON public.odds_cache
  FOR SELECT
  TO public
  USING (true);

-- Trigger for updated_at
CREATE TRIGGER update_odds_cache_updated_at
  BEFORE UPDATE ON public.odds_cache
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();
