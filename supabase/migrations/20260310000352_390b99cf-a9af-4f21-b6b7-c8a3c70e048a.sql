CREATE TABLE public.game_odds_snapshots (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  game_date date NOT NULL DEFAULT CURRENT_DATE,
  home_team text NOT NULL,
  away_team text NOT NULL,
  market_type text NOT NULL, -- 'h2h', 'spread', 'total'
  line numeric, -- spread value or total line (null for h2h)
  home_odds text,
  away_odds text,
  over_odds text,
  under_odds text,
  sportsbook text NOT NULL DEFAULT 'draftkings',
  snapshot_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.game_odds_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read game odds snapshots"
  ON public.game_odds_snapshots
  FOR SELECT
  TO public
  USING (true);