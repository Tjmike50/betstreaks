-- Block D: Security warning cleanup
-- 1) app_feedback: add admin SELECT policy so admins can review submissions via the API
CREATE POLICY "admins read feedback"
ON public.app_feedback
FOR SELECT
TO authenticated
USING (public.is_admin(auth.uid()));

-- 2) ai_slips: drop the anon SELECT policy that exposed all anon-created slips
-- Anon users still INSERT slips (policy preserved); the just-created slip is returned
-- in the edge function response, so no anon re-select is needed.
DROP POLICY IF EXISTS "read anon ai slips" ON public.ai_slips;