ALTER TABLE public.slip_leg_outcomes
  ADD COLUMN IF NOT EXISTS value_score numeric,
  ADD COLUMN IF NOT EXISTS books_count integer;