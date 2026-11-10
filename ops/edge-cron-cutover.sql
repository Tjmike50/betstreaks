-- Owner-run only. Pause the affected hosted jobs before deploying their new gates.
-- Requires pg_cron, pg_net and Vault. Only the commands of reviewed jobs change.
BEGIN;

DO $cutover$
DECLARE
  target record;
  job record;
  project_url text;
  pick_secret_name constant text := 'betstreaks_daily_pick_cron_secret';
  pipeline_secret_name constant text := 'betstreaks_pipeline_cron_secret';
  legacy_parts text[];
  prior_pick_command text;
  replacement text;
BEGIN
  SELECT min(decrypted_secret) INTO project_url
  FROM vault.decrypted_secrets
  WHERE name = 'betstreaks_project_url'
  HAVING count(*) = 1;
  IF project_url IS NULL OR project_url !~ '^https://[a-z0-9-]+[.]supabase[.]co$' THEN
    RAISE EXCEPTION 'The Vault project URL is missing or invalid';
  END IF;

  IF (
    SELECT count(DISTINCT name) = 2 AND count(*) = 2 AND count(DISTINCT decrypted_secret) = 2
    FROM vault.decrypted_secrets
    WHERE name IN (pick_secret_name, pipeline_secret_name)
      AND decrypted_secret ~ '^[A-Za-z0-9_-]{32,}$'
  ) IS NOT TRUE THEN
    RAISE EXCEPTION 'Two distinct, valid cron secrets are required in Vault';
  END IF;

  IF EXISTS (
    SELECT FROM cron.job
    WHERE (jobname ~ '^(daily-pipeline-|generate-daily-pick-|daily-pick-)'
        OR command ~ '/functions/v1/(run-daily-pipeline|generate-daily-pick|grade-outcomes|scoring-analysis)([^a-z0-9-]|$)')
      AND jobname NOT IN (
        'daily-pipeline-15', 'daily-pipeline-19', 'daily-pipeline-22',
        'generate-daily-pick-nba', 'generate-daily-pick-wnba',
        'daily-grade-outcomes', 'daily-scoring-analysis'
      )
  ) THEN
    RAISE EXCEPTION 'An unreviewed scheduler caller exists. Review job metadata before cutover';
  END IF;

  FOR target IN
    SELECT * FROM (VALUES
      ('daily-pipeline-15', 'run-daily-pipeline', '{}', true, pipeline_secret_name, 'x-pipeline-cron-secret'),
      ('daily-pipeline-19', 'run-daily-pipeline', '{}', true, pipeline_secret_name, 'x-pipeline-cron-secret'),
      ('daily-pipeline-22', 'run-daily-pipeline', '{}', true, pipeline_secret_name, 'x-pipeline-cron-secret'),
      ('generate-daily-pick-nba', 'generate-daily-pick', '{"sport":"NBA"}', true, pick_secret_name, 'x-daily-pick-cron-secret'),
      ('generate-daily-pick-wnba', 'generate-daily-pick', '{"sport":"WNBA"}', true, pick_secret_name, 'x-daily-pick-cron-secret'),
      ('daily-grade-outcomes', 'grade-outcomes', '{}', false, pipeline_secret_name, 'x-pipeline-cron-secret'),
      ('daily-scoring-analysis', 'scoring-analysis', '{"lookback_days":30}', false, pipeline_secret_name, 'x-pipeline-cron-secret')
    ) AS expected(job_name, function_name, request_body, required, secret_name, header_name)
  LOOP
    IF (SELECT count(*) FROM cron.job WHERE jobname = target.job_name) > 1 THEN
      RAISE EXCEPTION 'Ambiguous scheduler job %', target.job_name;
    END IF;
    SELECT jobid, command INTO job FROM cron.job WHERE jobname = target.job_name;
    IF NOT FOUND THEN
      IF target.required THEN RAISE EXCEPTION 'Missing scheduler job %', target.job_name; END IF;
      CONTINUE;
    END IF;

    replacement := format($job$
      SELECT net.http_post(
        url := project.value || %L,
        headers := jsonb_build_object('Content-Type', 'application/json', %L, credential.value),
        body := %L::jsonb
      )
      FROM (
        SELECT min(decrypted_secret) AS value
        FROM vault.decrypted_secrets WHERE name = 'betstreaks_project_url'
        HAVING count(*) = 1 AND min(decrypted_secret) ~ '^https://[a-z0-9-]+[.]supabase[.]co$'
      ) AS project
      CROSS JOIN (
        SELECT min(decrypted_secret) AS value
        FROM vault.decrypted_secrets WHERE name = %L
        HAVING count(*) = 1 AND min(decrypted_secret) ~ '^[A-Za-z0-9_-]{32,}$'
      ) AS credential;
    $job$, '/functions/v1/' || target.function_name, target.header_name,
          target.request_body, target.secret_name);

    IF job.command = replacement THEN CONTINUE; END IF;

    -- The first PR revision could already have migrated either pick job.
    IF target.secret_name = pick_secret_name THEN
      prior_pick_command := format($prior$
      SELECT net.http_post(
        url := %L,
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-daily-pick-cron-secret', decrypted_secret
        ),
        body := jsonb_build_object('sport', %L)
      )
      FROM vault.decrypted_secrets
      WHERE name = 'betstreaks_daily_pick_cron_secret'
        AND decrypted_secret ~ '^[A-Za-z0-9_-]{32,}$';
    $prior$, project_url || '/functions/v1/generate-daily-pick', target.request_body::jsonb->>'sport');
      IF job.command = prior_pick_command THEN
        PERFORM cron.alter_job(job.jobid, command := replacement);
        CONTINUE;
      END IF;
    END IF;

    -- Match only the reviewed historical command shape. Reject customized payloads,
    -- project URLs, extra statements and timeout options without printing job SQL.
    legacy_parts := regexp_match(job.command, $pattern$^\s*select\s+net[.]http_post\s*\(\s*url\s*:=\s*'([^']+)'\s*,\s*headers\s*:=\s*'\{\s*"Content-Type"\s*:\s*"application/json"\s*,\s*"Authorization"\s*:\s*"Bearer [A-Za-z0-9._-]+"\s*\}'::jsonb\s*,\s*body\s*:=\s*'([^']*)'::jsonb\s*\)\s+as\s+request_id\s*;\s*$pattern$ || '$', 'i');
    IF legacy_parts IS NULL
       OR legacy_parts[1] <> project_url || '/functions/v1/' || target.function_name
       OR regexp_replace(legacy_parts[2], '\s', '', 'g') <> target.request_body THEN
      RAISE EXCEPTION 'Unexpected scheduler command for %. Review without printing credentials', target.job_name;
    END IF;

    PERFORM cron.alter_job(job.jobid, command := replacement);
  END LOOP;
END
$cutover$;

COMMIT;
