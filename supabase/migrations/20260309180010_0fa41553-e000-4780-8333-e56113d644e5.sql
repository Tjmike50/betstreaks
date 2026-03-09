-- Reschedule grade-outcomes to 07:30 UTC (2:30 AM ET)
SELECT cron.unschedule('daily-grade-outcomes');

SELECT cron.schedule(
  'daily-grade-outcomes',
  '30 7 * * *',
  $$
  SELECT
    net.http_post(
      url:='https://enhksxikgvvdohseivpx.supabase.co/functions/v1/grade-outcomes',
      headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVuaGtzeGlrZ3Z2ZG9oc2VpdnB4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkzOTA4ODksImV4cCI6MjA4NDk2Njg4OX0.jXskDJkBGIUkWQF21b2-5UJSRuc2xEE4Ywbh5zjtnF8"}'::jsonb,
      body:='{}'::jsonb
    ) AS request_id;
  $$
);

-- Schedule scoring-analysis at 08:00 UTC (3:00 AM ET)
SELECT cron.schedule(
  'daily-scoring-analysis',
  '0 8 * * *',
  $$
  SELECT
    net.http_post(
      url:='https://enhksxikgvvdohseivpx.supabase.co/functions/v1/scoring-analysis',
      headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVuaGtzeGlrZ3Z2ZG9oc2VpdnB4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkzOTA4ODksImV4cCI6MjA4NDk2Njg4OX0.jXskDJkBGIUkWQF21b2-5UJSRuc2xEE4Ywbh5zjtnF8"}'::jsonb,
      body:='{"lookback_days": 30}'::jsonb
    ) AS request_id;
  $$
);