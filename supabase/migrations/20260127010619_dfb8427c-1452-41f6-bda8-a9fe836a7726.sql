-- Add columns for Last 10 and Last 5 hit tracking
ALTER TABLE public.streaks
ADD COLUMN last10_hits integer DEFAULT 0,
ADD COLUMN last10_games integer DEFAULT 0,
ADD COLUMN last5_hits integer DEFAULT 0,
ADD COLUMN last5_games integer DEFAULT 0;