-- Schedule line snapshot collection 3x daily on game days
-- 16:00 UTC = 11am ET (opening lines), 20:00 UTC = 3pm ET (mid-day), 23:00 UTC = 6pm ET (pre-tip)
SELECT cron.schedule(
  'collect-line-snapshots-16',
  '0 16 * * *',
  $$
  SELECT net.http_post(
    url:='https://enhksxikgvvdohseivpx.supabase.co/functions/v1/collect-line-snapshots',
    headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVuaGtzeGlrZ3Z2ZG9oc2VpdnB4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkzOTA4ODksImV4cCI6MjA4NDk2Njg4OX0.jXskDJkBGIUkWQF21b2-5UJSRuc2xEE4Ywbh5zjtnF8"}'::jsonb,
    body:='{}'::jsonb
  ) AS request_id;
  $$
);

SELECT cron.schedule(
  'collect-line-snapshots-20',
  '0 20 * * *',
  $$
  SELECT net.http_post(
    url:='https://enhksxikgvvdohseivpx.supabase.co/functions/v1/collect-line-snapshots',
    headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVuaGtzeGlrZ3Z2ZG9oc2VpdnB4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkzOTA4ODksImV4cCI6MjA4NDk2Njg4OX0.jXskDJkBGIUkWQF21b2-5UJSRuc2xEE4Ywbh5zjtnF8"}'::jsonb,
    body:='{}'::jsonb
  ) AS request_id;
  $$
);

SELECT cron.schedule(
  'collect-line-snapshots-23',
  '0 23 * * *',
  $$
  SELECT net.http_post(
    url:='https://enhksxikgvvdohseivpx.supabase.co/functions/v1/collect-line-snapshots',
    headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVuaGtzeGlrZ3Z2ZG9oc2VpdnB4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkzOTA4ODksImV4cCI6MjA4NDk2Njg4OX0.jXskDJkBGIUkWQF21b2-5UJSRuc2xEE4Ywbh5zjtnF8"}'::jsonb,
    body:='{}'::jsonb
  ) AS request_id;
  $$
);