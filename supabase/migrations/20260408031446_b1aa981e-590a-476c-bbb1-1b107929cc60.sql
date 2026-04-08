DROP POLICY IF EXISTS "public can join waitlist" ON public.premium_waitlist;
CREATE POLICY "public can join waitlist"
ON public.premium_waitlist
FOR INSERT
TO public
WITH CHECK (
  email IS NOT NULL
  AND (
    (auth.uid() IS NULL AND user_id IS NULL)
    OR (auth.uid() IS NOT NULL AND user_id = auth.uid())
  )
);

CREATE POLICY "Users can read own waitlist entry"
ON public.premium_waitlist
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

DROP POLICY IF EXISTS "admins read eval snapshots" ON public.eval_daily_snapshots;
CREATE POLICY "admins read eval snapshots"
ON public.eval_daily_snapshots
FOR SELECT
TO authenticated
USING (public.is_admin(auth.uid()));