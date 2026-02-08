-- Create analytics_events table for conversion funnel tracking
CREATE TABLE public.analytics_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  event_name TEXT NOT NULL,
  user_id UUID,
  metadata JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.analytics_events ENABLE ROW LEVEL SECURITY;

-- Allow anyone to insert analytics events (even anonymous users)
CREATE POLICY "Anyone can insert analytics events"
ON public.analytics_events
FOR INSERT
WITH CHECK (true);

-- Only allow users to read their own events (for debugging)
CREATE POLICY "Users can read own analytics"
ON public.analytics_events
FOR SELECT
USING (user_id = auth.uid());

-- Create index for faster queries by event name and date
CREATE INDEX idx_analytics_events_name_date ON public.analytics_events(event_name, created_at DESC);
CREATE INDEX idx_analytics_events_user ON public.analytics_events(user_id) WHERE user_id IS NOT NULL;