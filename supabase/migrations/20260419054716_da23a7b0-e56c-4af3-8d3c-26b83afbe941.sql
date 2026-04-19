-- Step 1: Enable required extensions
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Step 2: Schedule NBA Daily Pick generation at 14:30 UTC daily
-- Uses skip-on-conflict (no force flag) — safe to re-run, will not overwrite existing pick
SELECT cron.schedule(
  'generate-daily-pick-nba',
  '30 14 * * *',
  $$
  SELECT net.http_post(
    url := 'https://enhksxikgvvdohseivpx.supabase.co/functions/v1/generate-daily-pick',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVuaGtzeGlrZ3Z2ZG9oc2VpdnB4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkzOTA4ODksImV4cCI6MjA4NDk2Njg4OX0.jXskDJkBGIUkWQF21b2-5UJSRuc2xEE4Ywbh5zjtnF8"}'::jsonb,
    body := '{"sport": "NBA"}'::jsonb
  ) AS request_id;
  $$
);

-- Step 3: Schedule WNBA Daily Pick generation at 16:00 UTC daily
-- Offseason behavior: function returns clean skip with reason="no_candidates", inserts nothing
SELECT cron.schedule(
  'generate-daily-pick-wnba',
  '0 16 * * *',
  $$
  SELECT net.http_post(
    url := 'https://enhksxikgvvdohseivpx.supabase.co/functions/v1/generate-daily-pick',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVuaGtzeGlrZ3Z2ZG9oc2VpdnB4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkzOTA4ODksImV4cCI6MjA4NDk2Njg4OX0.jXskDJkBGIUkWQF21b2-5UJSRuc2xEE4Ywbh5zjtnF8"}'::jsonb,
    body := '{"sport": "WNBA"}'::jsonb
  ) AS request_id;
  $$
);