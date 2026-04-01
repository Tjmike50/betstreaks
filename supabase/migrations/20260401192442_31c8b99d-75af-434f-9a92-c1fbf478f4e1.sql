
-- Remove old separate cron jobs (replaced by unified pipeline)
SELECT cron.unschedule('refresh-availability-14');
SELECT cron.unschedule('refresh-availability-18');
SELECT cron.unschedule('refresh-availability-22');
SELECT cron.unschedule('collect-line-snapshots-16');
SELECT cron.unschedule('collect-line-snapshots-20');
SELECT cron.unschedule('collect-line-snapshots-23');

-- Schedule unified pipeline: 11am ET (15:00 UTC), 3pm ET (19:00 UTC), 6pm ET (22:00 UTC)
SELECT cron.schedule(
  'daily-pipeline-15',
  '0 15 * * *',
  $$
  SELECT net.http_post(
    url:='https://enhksxikgvvdohseivpx.supabase.co/functions/v1/run-daily-pipeline',
    headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVuaGtzeGlrZ3Z2ZG9oc2VpdnB4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkzOTA4ODksImV4cCI6MjA4NDk2Njg4OX0.jXskDJkBGIUkWQF21b2-5UJSRuc2xEE4Ywbh5zjtnF8"}'::jsonb,
    body:='{}'::jsonb
  ) AS request_id;
  $$
);

SELECT cron.schedule(
  'daily-pipeline-19',
  '0 19 * * *',
  $$
  SELECT net.http_post(
    url:='https://enhksxikgvvdohseivpx.supabase.co/functions/v1/run-daily-pipeline',
    headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVuaGtzeGlrZ3Z2ZG9oc2VpdnB4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkzOTA4ODksImV4cCI6MjA4NDk2Njg4OX0.jXskDJkBGIUkWQF21b2-5UJSRuc2xEE4Ywbh5zjtnF8"}'::jsonb,
    body:='{}'::jsonb
  ) AS request_id;
  $$
);

SELECT cron.schedule(
  'daily-pipeline-22',
  '0 22 * * *',
  $$
  SELECT net.http_post(
    url:='https://enhksxikgvvdohseivpx.supabase.co/functions/v1/run-daily-pipeline',
    headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVuaGtzeGlrZ3Z2ZG9oc2VpdnB4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkzOTA4ODksImV4cCI6MjA4NDk2Njg4OX0.jXskDJkBGIUkWQF21b2-5UJSRuc2xEE4Ywbh5zjtnF8"}'::jsonb,
    body:='{}'::jsonb
  ) AS request_id;
  $$
);
