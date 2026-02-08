-- Add is_admin column to user_flags table
ALTER TABLE public.user_flags 
ADD COLUMN IF NOT EXISTS is_admin boolean NOT NULL DEFAULT false;

-- Create index for admin lookups
CREATE INDEX IF NOT EXISTS idx_user_flags_is_admin ON public.user_flags(is_admin) WHERE is_admin = true;

-- Create a security definer function to check admin status (prevents RLS recursion)
CREATE OR REPLACE FUNCTION public.is_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT is_admin FROM public.user_flags WHERE user_id = _user_id),
    false
  )
$$;