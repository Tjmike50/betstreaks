
-- AI-generated slips table
CREATE TABLE public.ai_slips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  prompt text NOT NULL,
  slip_name text NOT NULL,
  risk_label text NOT NULL DEFAULT 'balanced',
  estimated_odds text,
  reasoning text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Individual legs of each AI slip
CREATE TABLE public.ai_slip_legs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slip_id uuid REFERENCES public.ai_slips(id) ON DELETE CASCADE NOT NULL,
  player_name text NOT NULL,
  team_abbr text,
  stat_type text NOT NULL,
  line text NOT NULL,
  pick text NOT NULL,
  odds text,
  reasoning text,
  leg_order integer NOT NULL DEFAULT 0
);

-- Saved slips (bookmarked by users)
CREATE TABLE public.saved_slips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  slip_id uuid REFERENCES public.ai_slips(id) ON DELETE CASCADE NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, slip_id)
);

-- Daily AI picks (Slip of the Day)
CREATE TABLE public.ai_daily_picks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pick_date date NOT NULL DEFAULT CURRENT_DATE,
  risk_label text NOT NULL,
  slip_name text NOT NULL,
  estimated_odds text,
  reasoning text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(pick_date, risk_label)
);

CREATE TABLE public.ai_daily_pick_legs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  daily_pick_id uuid REFERENCES public.ai_daily_picks(id) ON DELETE CASCADE NOT NULL,
  player_name text NOT NULL,
  team_abbr text,
  stat_type text NOT NULL,
  line text NOT NULL,
  pick text NOT NULL,
  odds text,
  reasoning text,
  leg_order integer NOT NULL DEFAULT 0
);

-- User AI usage tracking (for free tier limits)
CREATE TABLE public.ai_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  usage_date date NOT NULL DEFAULT CURRENT_DATE,
  request_count integer NOT NULL DEFAULT 1,
  UNIQUE(user_id, usage_date)
);

-- Enable RLS
ALTER TABLE public.ai_slips ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_slip_legs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saved_slips ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_daily_picks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_daily_pick_legs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_usage ENABLE ROW LEVEL SECURITY;

-- ai_slips: users can read own, anyone can insert (edge function creates with user_id)
CREATE POLICY "read own ai slips" ON public.ai_slips FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "insert own ai slips" ON public.ai_slips FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "read anon ai slips" ON public.ai_slips FOR SELECT TO anon USING (user_id IS NULL);
CREATE POLICY "insert anon ai slips" ON public.ai_slips FOR INSERT TO anon WITH CHECK (user_id IS NULL);

-- ai_slip_legs: readable if parent slip is readable
CREATE POLICY "read slip legs" ON public.ai_slip_legs FOR SELECT USING (true);
CREATE POLICY "insert slip legs" ON public.ai_slip_legs FOR INSERT WITH CHECK (true);

-- saved_slips: users manage own
CREATE POLICY "manage own saved slips" ON public.saved_slips FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- daily picks: public read
CREATE POLICY "public read daily picks" ON public.ai_daily_picks FOR SELECT USING (true);
CREATE POLICY "public read daily pick legs" ON public.ai_daily_pick_legs FOR SELECT USING (true);

-- ai_usage: users manage own
CREATE POLICY "manage own ai usage" ON public.ai_usage FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
