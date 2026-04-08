-- Replace the ALL policy on ai_usage with separate SELECT and INSERT policies
-- This prevents users from deleting/updating their usage records to bypass rate limits

DROP POLICY IF EXISTS "manage own ai usage" ON public.ai_usage;

-- Users can read their own usage
CREATE POLICY "read own ai usage"
ON public.ai_usage
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

-- Users can insert their own usage (for upsert from edge functions)
CREATE POLICY "insert own ai usage"
ON public.ai_usage
FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());