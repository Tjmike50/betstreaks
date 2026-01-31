-- Enable RLS on all public data tables that currently have it disabled
ALTER TABLE public.games_today ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.player_recent_games ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_recent_games ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.streak_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.refresh_status ENABLE ROW LEVEL SECURITY;

-- Add public read-only access policies
-- No INSERT/UPDATE/DELETE policies means only service_role can write

CREATE POLICY "Public read access" ON public.games_today
FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "Public read access" ON public.player_recent_games
FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "Public read access" ON public.team_recent_games
FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "Public read access" ON public.streak_events
FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "Public read access" ON public.refresh_status
FOR SELECT TO anon, authenticated USING (true);