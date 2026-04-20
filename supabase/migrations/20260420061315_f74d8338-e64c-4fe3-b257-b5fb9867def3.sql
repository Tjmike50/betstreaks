-- Add player_name to mlb_player_profiles for snapshot name→id resolution.
ALTER TABLE public.mlb_player_profiles
  ADD COLUMN IF NOT EXISTS player_name text;

-- Functional lower() index for fast case-insensitive name lookup.
CREATE INDEX IF NOT EXISTS mlb_player_profiles_name_lower_idx
  ON public.mlb_player_profiles (lower(player_name));