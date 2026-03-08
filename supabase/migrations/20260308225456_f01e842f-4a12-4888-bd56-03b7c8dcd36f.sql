
-- Schedule daily grading at 10:30 AM UTC (5:30 AM ET, after overnight games finish)
SELECT
  cron.schedule(
    'daily-grade-outcomes',
    '30 10 * * *',
    $$
    SELECT
      net.http_post(
        url:='https://enhksxikgvvdohseivpx.supabase.co/functions/v1/grade-outcomes',
        headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVuaGtzeGlrZ3Z2ZG9oc2VpdnB4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkzOTA4ODksImV4cCI6MjA4NDk2Njg4OX0.jXskDJkBGIUkWQF21b2-5UJSRuc2xEE4Ywbh5zjtnF8"}'::jsonb,
        body:='{}'::jsonb
      ) AS request_id;
    $$
  );
