CREATE TABLE IF NOT EXISTS public.premium_weekly_passes (
  checkout_session_id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  weeks integer NOT NULL CHECK (weeks BETWEEN 1 AND 520),
  starts_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > starts_at)
);
CREATE INDEX IF NOT EXISTS premium_weekly_passes_user_expiry
  ON public.premium_weekly_passes(user_id, expires_at DESC);
ALTER TABLE public.premium_weekly_passes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.premium_weekly_passes FROM anon, authenticated;
GRANT SELECT ON public.premium_weekly_passes TO authenticated;
GRANT ALL ON public.premium_weekly_passes TO service_role;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
    AND tablename = 'premium_weekly_passes' AND policyname = 'Read own weekly passes') THEN
    CREATE POLICY "Read own weekly passes" ON public.premium_weekly_passes
      FOR SELECT TO authenticated USING (user_id = auth.uid());
  END IF;
END $$;

-- Only the signed webhook's backend may grant time. The lock and unique
-- Checkout ID make retries and simultaneous purchases safe.
CREATE OR REPLACE FUNCTION public.grant_weekly_pass(
  p_user_id uuid, p_checkout_session_id text, p_weeks integer
) RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  existing public.premium_weekly_passes%ROWTYPE;
  pass_start timestamptz;
  pass_end timestamptz;
BEGIN
  IF p_user_id IS NULL OR p_checkout_session_id IS NULL
     OR left(p_checkout_session_id, 3) <> 'cs_'
     OR p_weeks IS NULL OR p_weeks NOT BETWEEN 1 AND 520 THEN
    RAISE EXCEPTION 'Invalid weekly pass';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));
  SELECT * INTO existing FROM public.premium_weekly_passes
    WHERE checkout_session_id = p_checkout_session_id;
  IF FOUND THEN
    IF existing.user_id <> p_user_id OR existing.weeks <> p_weeks THEN
      RAISE EXCEPTION 'Checkout already belongs to another purchase';
    END IF;
    RETURN existing.expires_at;
  END IF;
  SELECT greatest(now(), coalesce(max(expires_at), now())) INTO pass_start
    FROM public.premium_weekly_passes WHERE user_id = p_user_id;
  pass_end := pass_start + (p_weeks * interval '168 hours');
  INSERT INTO public.premium_weekly_passes
    (checkout_session_id, user_id, weeks, starts_at, expires_at)
    VALUES (p_checkout_session_id, p_user_id, p_weeks, pass_start, pass_end);
  RETURN pass_end;
END;
$$;
REVOKE ALL ON FUNCTION public.grant_weekly_pass(uuid, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grant_weekly_pass(uuid, text, integer) TO service_role;

-- Read current caller's access at request time; expiry needs no scheduled job.
-- Existing subscription, manual and lifetime flags remain independent.
CREATE OR REPLACE FUNCTION public.get_premium_access()
RETURNS TABLE(is_premium boolean, base_premium boolean, weekly_expires_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT base.active OR coalesce(pass.expires_at > now(), false), base.active, pass.expires_at
  FROM (SELECT coalesce((SELECT f.is_premium FROM public.user_flags f
    WHERE f.user_id = auth.uid()), false) AS active) base
  CROSS JOIN (SELECT max(p.expires_at) AS expires_at FROM public.premium_weekly_passes p
    WHERE p.user_id = auth.uid()) pass;
$$;
REVOKE ALL ON FUNCTION public.get_premium_access() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_premium_access() TO authenticated, service_role;

ALTER POLICY "premium only read streak events" ON public.streak_events
  USING ((SELECT a.is_premium FROM public.get_premium_access() a) OR public.is_admin(auth.uid()));
