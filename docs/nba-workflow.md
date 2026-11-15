# NBA research workflow

The customer route is `/research/nba`. The review builds on the BetStreaks security branch. `VITE_NBA_WORKFLOW_ENABLED=true` exposes the routes and links from Research, NBA cheatsheets, Builder, Analyzer, Saved Slips, and Watchlist. The legacy Analyzer and its historical grades still use their original path. Verified research slips have their own saved records and results.

## Run the fixture demo

From the repo root, use Node 22 with npm. Install the locked dependencies once, then start the demo.

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run demo:nba
```

Open [NBA Research on loopback](http://127.0.0.1:47962/research/nba) or [the NBA cheatsheet](http://127.0.0.1:47962/cheatsheets/best-bets). Set `NBA_DEMO_PORT` before startup if you need another port. The demo binds to loopback, injects a fake Supabase key, blocks external browser requests, and runs the same research handler as the Edge Function. Its data is fictional. Its app state and fixture clock reset when the process restarts.

| Fixture login | Password | Role |
| --- | --- | --- |
| `analyst@example.invalid` | `demo-only-password` | Free |
| `premium@example.invalid` | `demo-only-password` | Premium and demo diagnostics |

1. Open **Explain this line** on Avery Stone's Best Bets row. Sign in to return to the selected prop. Select five appearances and change points to 20. The evidence shows **1/5**, two misses and two pushes. Open the appearance list and the score breakdown.
2. Compare Demo North and Demo South. Add Demo North's main line to the draft. In **Saved slips**, paste a second leg using `Casey Lane | Rebounds | Over | 5 | Demo South`. Confirm the exact quote and save. Casey's final result is a push.
3. Follow Demo North's Avery quote and Demo South's Avery quote. Choose update types or set quiet hours in **Watchlist**.
4. Click **Advance demo slate** once. Demo North moves from 20.5 to 21.5. Demo South changes price at the same line. Avery settles using the original saved threshold. Verify that watchlist events persist across refresh, then mark them read. Repeat with Jordan Reed before advancing to see availability and a void.
5. Under **Ask**, ask “Why is this ranked, and did the price move?” Stats, score, and odds come from the tools. The demo uses the same rules fallback that hosted BetStreaks uses if Gemini is unavailable. Report an answer and sign in as the demo admin to view its reference under **Diagnostics**. A separate account starts with its own saved slips and preferences.

## Connect hosted staging

- **Staging target.** Supply access to a BetStreaks nonproduction Supabase project and an HTTPS frontend preview. Rehearse the base security branch first, apply the workflow migration, then deploy `nba-workflow` and `nba-workflow-push`. Configure the staging project's own modern Supabase keys and `ANALYTICS_ALLOWED_ORIGINS` with the exact frontend origin. Set the frontend `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, and `VITE_NBA_WORKFLOW_ENABLED=true`. Use staging Free, Premium, and admin users. The feature uses verified signed-in sessions and stores its own account records.
- **Source connection.** Until a verified source is available, the server can use `NBA_WORKFLOW_MODE=fixture` on a dedicated staging environment. For real data, connect the approved refresh pipeline to generate and publish the snapshot below, confirm feed permissions for display and model processing, and switch to `NBA_WORKFLOW_MODE=verified`. The loader requires an explicitly verified snapshot and rejects malformed or future revisions. Existing raw tables alone do not establish full game-log coverage or canonical market matching.
- **Google Gemini.** Use the existing Lovable gateway integration and set the staging Edge secrets `LOVABLE_API_KEY` and `NBA_WORKFLOW_GOOGLE_MODEL` to the authorized Google Gemini model identifier, such as the one used by the existing Analyzer. The feature only sends the question and bounded filter defaults to Gemini. The model returns a validated read-only tool plan. Edge code calculates stats, rechecks quotes, and renders evidence. `NBA_WORKFLOW_MODEL_DAILY_LIMIT` and `NBA_WORKFLOW_MODEL_USER_DAILY_LIMIT` default to 200 and 15 calls respectively, counted atomically in PostgreSQL. Unconfigured, exhausted, and failed model calls use the local question rules.
- **Watchlist worker and Web Push.** Put `NBA_WORKFLOW_VAPID_PUBLIC_KEY`, `NBA_WORKFLOW_VAPID_PRIVATE_KEY`, `NBA_WORKFLOW_VAPID_SUBJECT`, and a dedicated high-entropy `NBA_WORKFLOW_PUSH_CRON_SECRET` in staging Edge secrets. Configure a scoped scheduler to POST to `nba-workflow-push` using the secret in `x-nba-workflow-push-secret`. Verify the scheduler runs after snapshot refresh and rehearse physical browser opt-in, quiet hours, revoked subscriptions, and deduplication. The worker records changes for followed quotes even when push is disabled. In-app alerts are also reconciled when a user opens the board. Push notifications are generic and open the authenticated watchlist.
- **Live rollout.** Check verified source completeness, exact market and result matching against real sample records, hosted auth isolation, the Gemini request path, and physical push delivery in staging. Review the named staging project and release revision before production deployment. Disable the frontend flag or unset the workflow mode to pause release. Use the [security release runbook](../ops/SECURITY_RELEASE_RUNBOOK.md) for scheduled-job and credential cutover.

### Snapshot handoff

The approved refresh job should produce a JSON object with `board`, `appearances`, and `completePlayerIds`. The schema is described by [the board contract](../supabase/functions/_shared/nbaWorkflow/domain.ts) and [appearance contract](../supabase/functions/_shared/analyticsAssistant/source.ts). The loader applies [source validation](../supabase/functions/_shared/nbaWorkflow/store.ts).

- The board needs a named verified source, revision, observation and provider-fetch timestamps, and Eastern coverage cutoff. Include stable NBA event and player IDs, market ID, side, stat, quotes by exact sportsbook and line, previous quotes, score contributions, availability, and confirmed results. Preserve a stable event ID through rescheduling. Publish ISO timestamps in UTC with milliseconds.
- Quotes expire for saving and alerts after 15 minutes in verified mode. An older quote can still be shown with its observed timestamp. Keep settled markets in subsequent snapshots for the slip review retention period. Missing markets and incomplete games display as unverified.
- Include explicit eligibility for each appearance and only list an ID in `completePlayerIds` when the refresh can attest complete coverage. An absent stat stays null. The historical comparison uses the date before the event to avoid counting the target game's outcome.
- The initial normalized contract covers NBA points, rebounds, assists, and three-pointers made, with over, under, and at-least markets. Whole-number over/under uses pushes and at-least uses inclusive settlement. Void status must come from the approved data and rules. Verified combined same-game pricing requires a separate sportsbook quote source.
- Validate the JSON locally using the publisher before connecting the approved pipeline. It publishes via a single service-only RPC, preserving newer revisions and allowing idempotent retries.

```sh
deno run --frozen --allow-read=/path/to/snapshot.json ops/publish-nba-workflow-snapshot.ts /path/to/snapshot.json
```

For publishing, configure `NBA_WORKFLOW_PROJECT_REF` and `NBA_WORKFLOW_PUBLISHER_KEY` securely in the staging publisher job. Allow network access to that project's Supabase hostname, allow those two environment variables, and append `--publish`. The publisher rejects unverified input and does not print keys or rows.

## Verify

```sh
npm test
npx --no-install tsc -p tsconfig.app.json --noEmit
npx --no-install tsc -p tsconfig.node.json --noEmit
deno check --frozen supabase/functions/*/index.ts ops/analytics-demo.ts ops/publish-nba-workflow-snapshot.ts
deno test --frozen --import-map=ops/tests/deno-imports.json --allow-env supabase/functions/
```

The Deno test-only import map resolves the existing Stripe SDK version from the npm lockfile because esm.sh served different bytes for a transitive runtime module during PR verification. Edge source imports and the frozen Edge type check still use the deployment URLs.

Against a disposable PostgreSQL database, run `psql -f ops/tests/nba-workflow-db.sql` with the appropriate local connection args. The test applies the migration in a rolled-back transaction and verifies service permissions, monotonic snapshots, shared model limits and push claims.

On a fresh fixture server, run the Chromium walkthrough with Playwright CLI. It uses desktop and 390 px viewports and checks that the two fixture accounts see separate saved slips.

```sh
playwright-cli -s=betstreaks-nba open http://127.0.0.1:47962/cheatsheets/best-bets
playwright-cli -s=betstreaks-nba run-code --filename=ops/tests/nba-workflow-browser.js
playwright-cli -s=betstreaks-nba close
```
