#!/bin/bash
# Runs the real cutover in socket-only PostgreSQL. pg_cron, pg_net and Vault are local fixtures.
set -euo pipefail
root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)"
pg_bin="${PG_BIN:-$(pg_config --bindir)}"
scratch="$(mktemp -d /tmp/betstreaks-cron-qa.XXXXXX)"
cleanup() {
  "$pg_bin/pg_ctl" -D "$scratch/data" -m immediate -w stop >/dev/null 2>&1 || true
  rm -rf -- "$scratch"
}
trap cleanup EXIT
"$pg_bin/initdb" -D "$scratch/data" -A trust --no-locale >"$scratch/init.log"
"$pg_bin/pg_ctl" -D "$scratch/data" -l "$scratch/server.log" -o "-h '' -k $scratch -p 55443" -w start >/dev/null

sql() {
  env -i PATH="$PATH" HOME="$scratch" "$pg_bin/psql" -X -q -v ON_ERROR_STOP=1 \
    -h "$scratch" -p 55443 -U "$(id -un)" -d postgres "$@"
}
cutover() {
  sql -f "$root/ops/edge-cron-cutover.sql"
}
expect_failure() {
  local reason="$1"
  if cutover >"$scratch/rejected.log" 2>&1 || ! rg -q -- "$reason" "$scratch/rejected.log"; then
    printf 'Expected cutover rejection: %s\n' "$reason" >&2
    exit 1
  fi
}

sql <<'SQL'
CREATE SCHEMA cron;
CREATE SCHEMA net;
CREATE SCHEMA vault;
CREATE TABLE cron.job (
  jobid int GENERATED ALWAYS AS IDENTITY PRIMARY KEY, jobname text,
  schedule text, command text, database text DEFAULT 'postgres',
  username text DEFAULT 'fixture_owner', active boolean DEFAULT true
);
CREATE FUNCTION cron.alter_job(target int, command text) RETURNS void LANGUAGE sql AS $$
  UPDATE cron.job SET command = $2 WHERE jobid = $1
$$;
CREATE TABLE vault.decrypted_secrets (name text, decrypted_secret text);
CREATE TABLE net.receipts (url text, headers jsonb, body jsonb);
CREATE FUNCTION net.http_post(url text, headers jsonb, body jsonb) RETURNS bigint LANGUAGE sql AS $$
  INSERT INTO net.receipts VALUES ($1, $2, $3) RETURNING 1::bigint
$$;
INSERT INTO vault.decrypted_secrets VALUES
  ('betstreaks_project_url', 'https://fixture.supabase.co'),
  ('betstreaks_daily_pick_cron_secret', repeat('a', 40)),
  ('betstreaks_pipeline_cron_secret', repeat('b', 40));
INSERT INTO cron.job (jobname, schedule, command, active)
SELECT name, cadence,
  format('SELECT net.http_post(url := %L, headers := %L::jsonb, body := %L::jsonb) AS request_id;',
    'https://fixture.supabase.co/functions/v1/' || fn,
    '{"Content-Type": "application/json", "Authorization": "Bearer fixture_legacy"}', payload),
  active
FROM (VALUES
  ('daily-pipeline-15', '0 15 * * *', 'run-daily-pipeline', '{}', true),
  ('daily-pipeline-19', '0 19 * * *', 'run-daily-pipeline', '{}', false),
  ('daily-pipeline-22', '0 22 * * *', 'run-daily-pipeline', '{}', true),
  ('generate-daily-pick-nba', '30 14 * * *', 'generate-daily-pick', '{"sport": "NBA"}', true),
  ('generate-daily-pick-wnba', '0 16 * * *', 'generate-daily-pick', '{"sport": "WNBA"}', false),
  ('daily-grade-outcomes', '30 7 * * *', 'grade-outcomes', '{}', true),
  ('daily-scoring-analysis', '0 8 * * *', 'scoring-analysis', '{"lookback_days": 30}', true)
) AS input(name, cadence, fn, payload, active);
CREATE TABLE public.original AS TABLE cron.job;
SQL

sql -c "DELETE FROM vault.decrypted_secrets WHERE name = 'betstreaks_pipeline_cron_secret'" >/dev/null
expect_failure 'Two distinct, valid cron secrets'
sql -c "INSERT INTO vault.decrypted_secrets VALUES ('betstreaks_pipeline_cron_secret', repeat('b',40))" >/dev/null
printf '%s\n' 'PASS missing Vault configuration rejects the cutover'

sql -c "UPDATE cron.job SET jobname = 'fixture-absent', command = '' WHERE jobname = 'generate-daily-pick-wnba'" >/dev/null
expect_failure 'Missing scheduler job generate-daily-pick-wnba'
sql <<'SQL'
DO $$ BEGIN
  IF EXISTS (
    SELECT FROM cron.job j JOIN public.original o USING (jobid)
    WHERE j.jobname <> 'fixture-absent' AND j.command <> o.command
  ) THEN RAISE EXCEPTION 'Changes before the missing job did not roll back'; END IF;
END $$;
UPDATE cron.job j SET jobname = o.jobname, command = o.command
FROM public.original o WHERE j.jobid = o.jobid AND j.jobname = 'fixture-absent';
SQL
printf '%s\n' 'PASS missing required job rolls back earlier updates'

sql -c "INSERT INTO cron.job(jobname,schedule,command) VALUES ('daily-pipeline-fixture','0 9 * * *','SELECT 1;')" >/dev/null
expect_failure 'An unreviewed scheduler caller'
sql -c "DELETE FROM cron.job WHERE jobname = 'daily-pipeline-fixture'" >/dev/null
printf '%s\n' 'PASS additional scheduler caller stops cutover'

sql -c "UPDATE cron.job SET command = command || ' SELECT 1;' WHERE jobname = 'daily-pipeline-22'" >/dev/null
expect_failure 'Unexpected scheduler command for daily-pipeline-22'
sql -c "UPDATE cron.job j SET command = o.command FROM public.original o WHERE j.jobid = o.jobid" >/dev/null
printf '%s\n' 'PASS command drift is rejected'

sql <<'SQL'
UPDATE cron.job SET command = $prior$
      SELECT net.http_post(
        url := 'https://fixture.supabase.co/functions/v1/generate-daily-pick',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-daily-pick-cron-secret', decrypted_secret
        ),
        body := jsonb_build_object('sport', 'NBA')
      )
      FROM vault.decrypted_secrets
      WHERE name = 'betstreaks_daily_pick_cron_secret'
        AND decrypted_secret ~ '^[A-Za-z0-9_-]{32,}$';
    $prior$
WHERE jobname = 'generate-daily-pick-nba';
SQL
cutover
printf '%s\n' 'PASS an existing secure daily-pick cutover can be upgraded'

cutover
sql <<'SQL'
DO $$ BEGIN
  IF (SELECT count(*) FROM cron.job) <> 7 OR EXISTS (
    SELECT FROM cron.job j FULL JOIN public.original o USING (jobid)
    WHERE j.jobid IS NULL OR o.jobid IS NULL OR
      (j.jobname,j.schedule,j.database,j.username,j.active) IS DISTINCT FROM
      (o.jobname,o.schedule,o.database,o.username,o.active)
  ) OR EXISTS (
    SELECT FROM cron.job WHERE command LIKE '%fixture_legacy%' OR command LIKE '%Bearer%'
  ) THEN RAISE EXCEPTION 'Identity, cadence or authorization mismatch'; END IF;
END $$;
SQL
printf '%s\n' 'PASS all seven jobs keep identity and cadence through an idempotent rewrite'

sql >/dev/null <<'SQL'
UPDATE vault.decrypted_secrets SET decrypted_secret = repeat('c',40)
WHERE name = 'betstreaks_pipeline_cron_secret';
SELECT command FROM cron.job ORDER BY jobid \gexec
DO $$ BEGIN
  IF (SELECT count(*) FROM net.receipts) <> 7
    OR (SELECT count(*) FROM net.receipts WHERE headers->>'x-daily-pick-cron-secret' = repeat('a',40)) <> 2
    OR (SELECT count(*) FROM net.receipts WHERE headers->>'x-pipeline-cron-secret' = repeat('c',40)) <> 5
    OR (SELECT count(*) FROM net.receipts WHERE url = 'https://fixture.supabase.co/functions/v1/run-daily-pipeline' AND body = '{}') <> 3
    OR (SELECT count(*) FROM net.receipts WHERE url = 'https://fixture.supabase.co/functions/v1/generate-daily-pick' AND body IN ('{"sport":"NBA"}','{"sport":"WNBA"}')) <> 2
    OR NOT EXISTS (SELECT FROM net.receipts WHERE url = 'https://fixture.supabase.co/functions/v1/scoring-analysis' AND body = '{"lookback_days":30}')
    OR NOT EXISTS (SELECT FROM net.receipts WHERE url = 'https://fixture.supabase.co/functions/v1/grade-outcomes' AND body = '{}')
    OR EXISTS (SELECT FROM net.receipts WHERE headers ? 'Authorization' OR headers ? 'apikey')
  THEN RAISE EXCEPTION 'Unexpected fixture HTTP receipts'; END IF;
END $$;
TRUNCATE net.receipts;
DELETE FROM vault.decrypted_secrets WHERE name = 'betstreaks_pipeline_cron_secret';
SELECT command FROM cron.job WHERE jobname = 'daily-pipeline-15' \gexec
DO $$ BEGIN
  IF EXISTS (SELECT FROM net.receipts) THEN RAISE EXCEPTION 'Request without a Vault secret'; END IF;
END $$;
SQL
printf '%s\n' 'PASS commands preserve payloads and use only the current scoped Vault value'
printf '%s\n' 'PASS missing runtime secret queues zero requests'

sql -c "DELETE FROM cron.job WHERE jobname IN ('daily-grade-outcomes','daily-scoring-analysis')" >/dev/null
sql -c "INSERT INTO vault.decrypted_secrets VALUES ('betstreaks_pipeline_cron_secret', repeat('b',40))" >/dev/null
cutover
sql <<'SQL'
DO $$ BEGIN
  IF (SELECT count(*) FROM cron.job) <> 5 THEN RAISE EXCEPTION 'Retired maintenance job recreated'; END IF;
END $$;
SQL
printf '%s\n' 'PASS retired optional jobs remain absent'
