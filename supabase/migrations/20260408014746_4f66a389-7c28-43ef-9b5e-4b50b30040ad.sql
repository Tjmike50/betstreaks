-- Fix analytics_events: prevent user_id spoofing on INSERT
DROP POLICY IF EXISTS "Anyone can insert analytics events" ON public.analytics_events;

CREATE POLICY "Insert own or anon analytics events"
ON public.analytics_events
FOR INSERT
TO public
WITH CHECK (
  user_id = auth.uid() OR user_id IS NULL
);

-- Fix analytics_events: restrict SELECT to authenticated users only
DROP POLICY IF EXISTS "Users can read own analytics" ON public.analytics_events;

CREATE POLICY "Authenticated users read own analytics"
ON public.analytics_events
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

-- Add admin-only SELECT on premium_waitlist
CREATE POLICY "Admins can read waitlist"
ON public.premium_waitlist
FOR SELECT
TO authenticated
USING (public.is_admin(auth.uid()));