-- Owner-run cutover. Seed the Vault secret in the Dashboard before running.
-- Edit the two existing commands in one transaction, preserving their
-- job IDs, schedule expressions, database, owner and active flags.
BEGIN;

DO $cutover$
DECLARE
  job record;
  pick_sport text;
BEGIN
  IF (
    SELECT count(*) FROM vault.decrypted_secrets
    WHERE name = 'betstreaks_daily_pick_cron_secret'
      AND decrypted_secret ~ '^[A-Za-z0-9_-]{32,}$'
  ) <> 1 THEN
    RAISE EXCEPTION 'Daily-pick cron Vault secret is missing or invalid';
  END IF;

  FOR pick_sport IN SELECT unnest(ARRAY['NBA', 'WNBA'])
  LOOP
    SELECT jobid INTO STRICT job FROM cron.job
    WHERE jobname = 'generate-daily-pick-' || lower(pick_sport);

    PERFORM cron.alter_job(job.jobid, command := format($job$
      SELECT net.http_post(
        url := 'https://enhksxikgvvdohseivpx.supabase.co/functions/v1/generate-daily-pick',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-daily-pick-cron-secret', decrypted_secret
        ),
        body := jsonb_build_object('sport', %L)
      )
      FROM vault.decrypted_secrets
      WHERE name = 'betstreaks_daily_pick_cron_secret'
        AND decrypted_secret ~ '^[A-Za-z0-9_-]{32,}$';
    $job$, pick_sport));
  END LOOP;
END
$cutover$;

COMMIT;
