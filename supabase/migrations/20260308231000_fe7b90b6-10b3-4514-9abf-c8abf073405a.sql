-- Add unique constraint on player_availability for upsert support
ALTER TABLE public.player_availability 
  ADD CONSTRAINT player_availability_player_game_unique UNIQUE (player_id, game_date);

-- Allow refresh_status to store availability tracking row (id=2)
-- refresh_status already exists, just need insert policy for service role (handled by service key)

-- Schedule availability refresh: 3x daily at 14:00, 18:00, 22:00 UTC (9am, 1pm, 5pm ET)
SELECT cron.schedule(
  'refresh-availability-14',
  '0 14 * * *',
  $$
  SELECT net.http_post(
    url:='https://enhksxikgvvdohseivpx.supabase.co/functions/v1/refresh-availability',
    headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVuaGtzeGlrZ3Z2ZG9oc2VpdnB4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkzOTA4ODksImV4cCI6MjA4NDk2Njg4OX0.jXskDJkBGIUkWQF21b2-5UJSRuc2xEE4Ywbh5zjtnF8"}'::jsonb,
    body:='{}'::jsonb
  ) AS request_id;
  $$
);

SELECT cron.schedule(
  'refresh-availability-18',
  '0 18 * * *',
  $$
  SELECT net.http_post(
    url:='https://enhksxikgvvdohseivpx.supabase.co/functions/v1/refresh-availability',
    headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVuaGtzeGlrZ3Z2ZG9oc2VpdnB4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkzOTA4ODksImV4cCI6MjA4NDk2Njg4OX0.jXskDJkBGIUkWQF21b2-5UJSRuc2xEE4Ywbh5zjtnF8"}'::jsonb,
    body:='{}'::jsonb
  ) AS request_id;
  $$
);

SELECT cron.schedule(
  'refresh-availability-22',
  '0 22 * * *',
  $$
  SELECT net.http_post(
    url:='https://enhksxikgvvdohseivpx.supabase.co/functions/v1/refresh-availability',
    headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVuaGtzeGlrZ3Z2ZG9oc2VpdnB4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkzOTA4ODksImV4cCI6MjA4NDk2Njg4OX0.jXskDJkBGIUkWQF21b2-5UJSRuc2xEE4Ywbh5zjtnF8"}'::jsonb,
    body:='{}'::jsonb
  ) AS request_id;
  $$
);