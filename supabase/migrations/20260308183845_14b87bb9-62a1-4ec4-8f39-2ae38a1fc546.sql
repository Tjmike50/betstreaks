
-- Player availability statuses for today's games
CREATE TABLE IF NOT EXISTS public.player_availability (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id bigint NOT NULL,
  player_name text NOT NULL,
  team_abbr text,
  game_date date NOT NULL DEFAULT CURRENT_DATE,
  status text NOT NULL DEFAULT 'active',  -- active, questionable, probable, doubtful, out
  reason text,  -- e.g. "ankle", "rest", "illness"
  source text DEFAULT 'derived',  -- 'derived' from game logs, 'manual', 'api'
  confidence text DEFAULT 'medium',  -- low, medium, high
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(player_id, game_date)
);

ALTER TABLE public.player_availability ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read player availability"
  ON public.player_availability FOR SELECT
  USING (true);

-- Index for fast lookups by team and date
CREATE INDEX IF NOT EXISTS idx_player_availability_team_date 
  ON public.player_availability(team_abbr, game_date);
