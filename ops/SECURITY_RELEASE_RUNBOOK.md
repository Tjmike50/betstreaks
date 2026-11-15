# BetStreaks security release runbook

The release is ready for local review after verification below. Hosted activation depends on the owner's credential, scheduler and runtime checks. This work extends security commit `8c6a7b9` in PR #1, stacked on billing isolation commit `9ac47f6`.

## Legacy dependency inventory

The baseline inventory comes from the PR source, tracked migration history, the local Mac LaunchAgent and refresh helpers, and read-only GitHub workflow metadata. Hosted jobs, secret presence and active deployment revisions require an owner check.

| Baseline surface | Dependency at `8c6a7b9` | Release behavior and owner verification |
|---|---|---|
| Browser bundle and repository config | `src/integrations/supabase/client.ts` embeds the legacy public anon JWT. Tracked `.env` also configures it under publishable-key names. | Build supplies `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. A legacy JWT, secret key or missing config fails the build. Browser Auth keeps the session token and preview storage path. Rebuild every Lovable preview and publish target that uses the old bundle. |
| Auth helpers and scoped endpoints | `_shared/adminAuth.ts` reads both legacy variables and accepts service-role bearer. `_shared/privilegedPost.ts` falls back to those legacy variables. The dependent paths are `generate-daily-pick`, `mlb-health-check`, `verify-schedule`, and admin and pipeline callers. | Shared helpers read the modern named key maps and permit the singular modern variables for local runtimes. A signed-in user's bearer is verified through Supabase Auth. Admin roles are checked separately. Generic internal endpoints authenticate a configured server key via `apikey`; the narrower endpoints require their own scope. |
| Stripe Supabase access | `create-checkout-session/handler.ts` and `create-portal-session/handler.ts` use both legacy variables. `stripe-webhook/handler.ts` uses the legacy privileged key for database work. | Checkout and portal verify the user with the publishable key plus the session bearer. Their server operations and signed webhook writes use the modern server key. Preserve Stripe signing secrets, price IDs, live/test account mapping and billing migration order. |
| Edge user auth and forwarding | `admin-trigger-refresh`, `ai-bet-analyzer` and `ai-bet-builder` reference both legacy keys. `forward-event` verifies optional identity with the old anon key and writes to a separate project with `EXTERNAL_SUPABASE_SERVICE_ROLE_KEY`. | Admin refresh status uses the shared verified admin gate. Existing builder/analyzer behavior uses modern app keys. Configure `EXTERNAL_SUPABASE_SECRET_KEY` separately against its own `EXTERNAL_SUPABASE_URL`, or leave forwarding unavailable until the destination is reconciled. Verify authenticated and anonymous event paths in staging. |
| Edge database and internal HTTP | `backfill-leg-scores`, `backfill-outcomes`, `collect-line-snapshots`, `get-odds`, `grade-mlb-props`, `grade-outcomes`, `mlb-stale-data-cleanup`, `prop-scoring-engine`, `refresh-availability`, `refresh-mlb-data`, `refresh-mlb-team-map`, `refresh-wnba-data`, `run-daily-pipeline`, `score-mlb-anchors`, `scoring-analysis` and `summarize-mlb-performance` read the service-role variable. The MLB and WNBA refresh gates also check the anon key or accept unverified bearer-shaped inputs. Pipeline, line collection and builder send the legacy key as a bearer to downstream Edge Functions. | Modern server key travels on `apikey`. Scoped scheduler and schedule verification headers remain separate. Privileged refresh and maintenance handlers verify caller authorization before work. The liveness `healthcheck` has no Supabase key dependency. |
| Admin operator snippets | `src/pages/AdminHealthPage.tsx` gives a legacy anon bearer example for line collection. | Example requires the operator's verified admin session. Confirm owner-only callers use the matching contract. |
| Supabase cron and SQL history | See job inventory below. Six historical migrations contain inline legacy public bearer values. | Preserve history and replace current commands in place. A fresh replay of the historical schedule SQL needs the owner cutover before scheduling is enabled. |
| Repository NBA runner | `scripts/refresh.py`, `scripts/run_refresh.sh` and `.github/workflows/refresh.yml` already started the modern-key transition. The setup guide permits competing agents, while Python's SDK can send the application key as a bearer. | The actual SDK transport sends the modern key on `apikey`. The repo runner uses a named secret key. The Mac obtains it from Keychain and the backup workflow from GitHub Secrets. Scheduled runs operate in game-log-only mode. |
| Standalone NBA helpers | `~/betstreaks-refresh/run_refresh.sh` contains the potentially exposed privileged credential. `refresh_players.py`, `refresh_teams.py` and `refresh_games_today.py` read `SUPABASE_SERVICE_ROLE_KEY`. Installed `com.betstreaks.refresh` targets this directory. Separate `Tjmike50/betstreaks-refresh` has an additional workflow. | Retire the standalone runner, replace the existing agent with the repository version and quarantine credential-bearing files under the incident procedure. Keep the separate workflow disabled. Both GitHub refresh workflows showed `disabled_inactivity` during the read-only check. The current GitHub default branch and the separate refresh repository still reference `SUPABASE_SERVICE_ROLE_KEY` in their workflow definitions. Keep them disabled until the main repository workflow has the reviewed replacement, and leave the separate workflow retired. |
| Runtime-only consumers | Hosted cron commands, external schedulers and database webhooks, manual scripts, secrets in old CI jobs, mobile/preview clients, and telemetry/export integrations may be outside repository source. | The owner inventories these before retirement. Record each consumer, credential class, owner, replacement, environment, and verification evidence. Record names, IDs and timestamps without key values. |

The old SQL definitions are in `20260308225456_*`, `20260308231000_*`, `20260308231548_*`, `20260309180010_*`, `20260401192442_*` and `20260419054716_*` under `supabase/migrations`. Known runnable source uses modern keys. Legacy references remain in historical migrations, deny tests and the local standalone tools awaiting retirement.

## Scheduler inventory

Historical schedule expressions below use the configured cron time zone. Confirm the live time zone, current metadata and job ownership before editing. Also check externally configured callers, including cron-job.org, Supabase Dashboard webhooks, LaunchAgents and workflow schedules.

| Job | Historical expression | Payload and required header |
|---|---|---|
| `daily-pipeline-15` | `0 15 * * *` | `run-daily-pipeline`, empty JSON, `x-pipeline-cron-secret` |
| `daily-pipeline-19` | `0 19 * * *` | Same |
| `daily-pipeline-22` | `0 22 * * *` | Same |
| `generate-daily-pick-nba` | `30 14 * * *` | `generate-daily-pick`, sport NBA, `x-daily-pick-cron-secret` |
| `generate-daily-pick-wnba` | `0 16 * * *` | `generate-daily-pick`, sport WNBA, `x-daily-pick-cron-secret` |
| `daily-grade-outcomes` | `30 7 * * *` | `grade-outcomes`, empty JSON, `x-pipeline-cron-secret`. Migrate if still present. |
| `daily-scoring-analysis` | `0 8 * * *` | `scoring-analysis`, lookback 30 days, `x-pipeline-cron-secret`. Migrate if still present. |

The April migration unschedules `refresh-availability-{14,18,22}` and `collect-line-snapshots-{16,20,23}` in favor of the pipeline. Confirm they are absent or disabled. Any additional active jobs performing those stages must be reviewed for duplication. The March grade-outcomes job previously ran at 10:30 in the scheduler's time zone. The cutover preserves the actual expression rather than replacing it with the historical value.

`edge-cron-cutover.sql` validates the existing job set and known command shapes, including the earlier secure pick-only cutover. It alters commands by job ID in one transaction and preserves job name, cadence, database, owner and current active flag. An absent required job, extra matching caller or customized command aborts the transaction. Review a custom payload or destination with its owner before adapting the SQL. Vault lookup at execution time lets a future scoped secret replacement take effect without editing every command. Missing or invalid runtime values queue no request.

The pipeline invokes the collector, availability, league-specific refresh and scorer with the modern server API key. It invokes `verify-schedule` with its own secret. The collector skips its nested availability and scoring calls when the pipeline owns those stages. A direct authorized collection still chains its normal downstream work. Admin-triggered pipeline and pick requests retain verified admin sessions. A scheduled pick cannot force regeneration.

## Merge and owner-controlled activation

1. **Review the release stack.** Review PR #1 against `fix/stripe-test-customer-isolation`, then integrate the reviewed combined branch into `main` in a separate release PR. Test the exact combined tip and review the billing schema requirements in [billing isolation](../docs/stripe-sandbox-isolation.md). Confirm Lovable and other release integrations are in an owner-controlled publish mode before merging to a release branch.
2. **Inventory and contain.** Review credential exposure history and Supabase request activity by metadata. Use [the SQL inventory](edge-cron-inventory.sql) without reading or exporting raw cron commands or credential values. Capture original job IDs, active flags, schedules, time zone, owner, database and intended function/payload. Check for unmanaged callers and previous deployments. If the owner sees evidence of active misuse, containment takes priority over completing the planned availability window. Key retirement and revocation require the owner's approval.
3. **Provision and rehearse in staging.** Configure the browser publishable key and Edge modern key maps. The Edge runtime expects `default` in `SUPABASE_PUBLISHABLE_KEYS` and `SUPABASE_SECRET_KEYS`. Local environments may supply `SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SECRET_KEY` when maps are absent. The app also needs `SUPABASE_URL`. Use independent named server keys for the Mac, backup workflow and external analytics project. Provision independent random values of at least 32 URL-safe characters for `DAILY_PICK_CRON_SECRET`, `PIPELINE_CRON_SECRET` and `SCHEDULE_VERIFICATION_SECRET`. Confirm `REFRESH_SECRET` is a separate modern scoped value if retained for manual scoring or external admin jobs. Vault entries are `betstreaks_project_url`, `betstreaks_daily_pick_cron_secret` and `betstreaks_pipeline_cron_secret`. Match the two scoped cron values to their Edge secrets. Verify the job owner can resolve Vault references and queue requests through pg_net. Restrict access to Vault, cron command metadata and pending request headers.
4. **Stage one coordinated release.** Rehearse login, refresh of an existing session, ordinary-user denial and admin reads. Exercise sandbox checkout, live-scope portal behavior using safe fixtures, signed webhook replay and weekly entitlement isolation. Rehearse both pick payloads, all pipeline league steps and authorized direct admin tools. Confirm a configured secret and a user token each use the expected header. Check any Lovable-generated client override and publish settings.
5. **Pause and drain in the approved production window.** Use the captured job IDs to pause active affected cron jobs and any competing external callers. Let in-flight work finish and record its outcome. Pause the legacy Mac writer and keep GitHub backup disabled. Preserve each job's original active flag for later restoration. Deploy the changed functions as a coordinated set with their matching config. In particular, pair the pipeline, collector, availability and scorer functions with `verify-schedule`, and deploy the pick and maintenance handlers with the cron rewrite. Include the three billing functions, modern client build and any billing schema prerequisite.
6. **Rewrite and verify.** Run [the cutover SQL](edge-cron-cutover.sql) in the selected owner's database. Rerun the metadata inventory and compare job IDs, owners, schedules, database, cadence and expected credential classification. Resume only previously active and approved jobs, and start the one designated Mac writer through [the Mac guide](REFRESH_SETUP_MAC.md). Verify normal app sign-in, billing and runtime behavior in the approved environment. Check pg_cron and pg_net status metadata, function response status, per-sport pipeline results and `pipeline_runs.success`. HTTP 207 or a failed/skipped required stage needs investigation. Refresh status ID 4 marks an attempted pipeline run. ID 1 tracks NBA game-log refresh. Use downstream data/date evidence as well as the timestamps.
7. **Retire the legacy credentials.** After every inventoried consumer has migrated, the owner disables legacy anon/service-role keys and follows Supabase's signing-key migration procedure. Confirm the state in the dashboard. Plan session refresh or reauthentication around migration to asymmetric signing keys and the retirement of the old signing secret. Clear old build configurations and quarantine or remove legacy credential-bearing copies under the incident procedure. Never validate the exposed value by sending it again. [API key migration](https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys) · [Compromised key procedure](https://supabase.com/docs/guides/security/rotate-leaked-api-keys) · [Signing keys](https://supabase.com/docs/guides/auth/signing-keys)

## Recovery

Keep affected jobs paused if any authorization, billing or data acceptance check fails. Use the inventory to identify the failed caller and restore operation with approved modern credentials. If Vault and Edge scoped values diverge, have the owner reconcile them through secure configuration. If a modern key is suspected compromised, replace it with a fresh approved key and update each affected consumer before resuming it.

For code recovery, use a known-good revision that already supports modern keys and the current scheduler contracts, or prepare a forward fix from the tested release. Keep the scoped Vault commands and modern client configuration. If safe compatible code is unavailable, keep the affected feature or writer paused until it is corrected. Avoid restoring historical SQL commands, the legacy Mac launcher, an old browser bundle or a retired key. Preserve Stripe signing/account mappings and replay supported failed webhook events only through an owner-approved recovery procedure. When a data refresh partially writes, check affected rows against the last successful run before retrying.

## Offline verification

Use the existing npm manifest and repaired npm lockfile. The Deno lockfile captures the complete Edge graph. Run the checks from a clean working copy with fixture browser config. The Python harness uses the pinned direct dependencies and local socket PostgreSQL uses fake Vault and pg_net functions.

```bash
npm ci --ignore-scripts
export VITE_SUPABASE_URL=https://fixture.supabase.co
export VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_offline_fixture
npm test
npx tsc --noEmit -p tsconfig.app.json
npx tsc --noEmit -p tsconfig.node.json
npm run build
deno check --frozen supabase/functions/*/index.ts
deno test --frozen --allow-env supabase/functions/
.venv/bin/python -B -m unittest discover -s ops/tests -p test_refresh.py -v
ops/tests/test-cron-cutover.sh
bash -n scripts/run_refresh.sh
bash -n ops/legacy-run-refresh.sh
bash -n ops/tests/test-cron-cutover.sh
plutil -lint ops/com.betstreaks.refresh.plist
```

Set `PG_BIN` to the directory containing the PostgreSQL server binaries if the default `pg_config --bindir` points at a client-only install. The SQL harness creates a disposable cluster with Unix sockets only and stubs the extensions. It verifies SQL semantics and HTTP enqueue arguments. The owner's rehearsal checks actual Supabase Cron/Vault privileges, gateway behavior, schedules and signed billing traffic. The launcher harness mocks Keychain, provider requests and launcher execution, and exercises the real Python SDK against an HTTP mock.

### Verified local results

| Check | Result |
|---|---|
| Clean npm install and frontend verification | 503 packages installed from the repaired npm lockfile. 26 Vitest tests passed across six files. App and tooling TypeScript checks passed. Vite built successfully with the existing large-bundle warning. |
| Deno 2.5.6 Edge verification | All 27 entry points typechecked with the frozen lockfile. All 125 backend tests passed with typechecking and without runtime network permission, including Stripe isolation, caller gates and pipeline header compatibility. |
| PostgreSQL 17.10 | Nine scenarios passed in disposable PostgreSQL with pg_cron, pg_net and Vault fixtures. This includes upgrade from the prior pick-only command and rollback on a missing required job. |
| Python 3.13.13 and launcher | 11 offline tests passed, including the actual Supabase Python SDK with an HTTP mock. All three shell scripts and the LaunchAgent template passed syntax checks. |

The complete Edge entry point check had 49 errors on the original security commit under the same Deno toolchain. The release changes fix the affected client type compatibility and narrow existing endpoint type errors. Local execution used fixture credentials. Hosted migrations, scheduler behavior and the actual scheduled Keychain session still require the staging rehearsal.

## Outstanding owner actions

Confirm active hosted callers and environment versions, approve the exposure/retirement plan, provision named API keys and scoped secrets securely, verify the actual scheduled Mac user's Keychain and runtime, rehearse on staging, and approve the production window and key retirement. A fresh fixture build cannot verify permissions, quotas, production webhooks or the current data feed. Staging sign-off and owner approval remain release gates.
