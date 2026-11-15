-- Read-only inventory. Return metadata and credential classification only.
SELECT jobid, jobname, schedule, database, username, active,
  CASE
    WHEN command LIKE '%x-daily-pick-cron-secret%' THEN 'daily-pick-scoped'
    WHEN command LIKE '%x-pipeline-cron-secret%' THEN 'pipeline-scoped'
    WHEN command ~* '"Authorization"\s*:\s*"Bearer ' THEN 'bearer-in-command'
    WHEN command ~* '\mapikey\M' THEN 'apikey-reference'
    ELSE 'review'
  END AS credential_mode
FROM cron.job
ORDER BY jobid;
