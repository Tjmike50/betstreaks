-- Add length constraints to app_feedback table
ALTER TABLE public.app_feedback
ADD CONSTRAINT message_length_check 
CHECK (char_length(message) >= 5 AND char_length(message) <= 5000);

ALTER TABLE public.app_feedback
ADD CONSTRAINT email_format_check
CHECK (email IS NULL OR email ~* '^[^\s@]+@[^\s@]+\.[^\s@]+$');

-- Drop existing policy
DROP POLICY IF EXISTS "anyone can submit feedback" ON public.app_feedback;

-- Create updated policy with validation
CREATE POLICY "anyone can submit feedback"
ON public.app_feedback
FOR INSERT
TO anon, authenticated
WITH CHECK (
  message IS NOT NULL 
  AND char_length(trim(message)) >= 5
  AND char_length(message) <= 5000
  AND category IN ('Bug', 'Feature Request', 'Data Issue', 'General')
);