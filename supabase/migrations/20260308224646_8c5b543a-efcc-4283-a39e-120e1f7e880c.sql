
-- Line snapshots for market movement tracking
CREATE TABLE IF NOT EXISTS public.line_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_name text NOT NULL,
  player_id bigint,
  stat_type text NOT NULL,
  threshold numeric NOT NULL,
  over_odds text,
  under_odds text,
  sportsbook text NOT NULL DEFAULT 'draftkings',
  game_date date NOT NULL DEFAULT CURRENT_DATE,
  snapshot_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.line_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read line snapshots"
  ON public.line_snapshots FOR SELECT
  USING (true);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_line_snapshots_player_date
  ON public.line_snapshots(player_name, stat_type, threshold, game_date);

CREATE INDEX IF NOT EXISTS idx_line_snapshots_snapshot_at
  ON public.line_snapshots(game_date, snapshot_at);
