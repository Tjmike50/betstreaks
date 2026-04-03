
-- Fix 1: Remove the dangerous UPDATE policy that lets users self-escalate
DROP POLICY IF EXISTS "update own flags" ON public.user_flags;

-- Also remove the INSERT policy - user_flags should only be created by backend/webhook
DROP POLICY IF EXISTS "insert own flags" ON public.user_flags;
