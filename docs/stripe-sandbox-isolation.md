# Stripe sandbox customer isolation

## Behavior and scope

The unfinished implementation selected the test Stripe key and price but queried/upserted `stripe_account_customers` under `betstreaks`. That sent a saved live customer ID to the sandbox. Invalid test keys also fell back to live selection, and test webhooks were dispatched as live BetStreaks events.

The fix preserves `StripeAccountId` (`legacy | betstreaks`) and existing live subscription architecture. Customer scope is now explicit:

| Configuration | Customer table | Scope |
| --- | --- | --- |
| Legacy live | `stripe_customers` | Existing unscoped legacy rows |
| BetStreaks live | `stripe_account_customers` | `betstreaks` |
| Sandbox | `stripe_account_customers` | `betstreaks_test` |

A sandbox checkout reads only its sandbox mapping. If absent, it searches for an email match using the selected test client, otherwise creates a test customer, then saves the sandbox mapping. Lookup or persistence failures prevent Checkout creation. Live mappings are never copied, deleted, or updated by this sandbox path.

`STRIPE_TEST_MODE=true` selects test configuration or fails before Checkout creation. A missing/malformed test key, webhook secret, or price for the requested plan returns `test_config_invalid` (503). Optional unconfigured test plans cannot use live prices. Remote authentication/price errors also stop processing without fallback. Syntactic validation cannot prove that a webhook secret belongs to the intended endpoint; the signed webhook smoke test remains necessary.

The Weekly Pass still uses a one-time, active USD price of 500 cents, with quantity equal to the selected whole number of weeks (1–520). Authentication, signup, success/cancel URLs, and live plan pricing are unchanged. Test prices must report `livemode=false`; returned test sessions must report `livemode=false` and have a `cs_test_` ID.

Webhook signatures are bound to the signing account's scope and the event's `livemode`. Event metadata cannot select a scope. Sandbox checkout/subscription deliveries only resolve/upsert sandbox customer mappings. They never write subscription mirrors, user flags, Weekly Pass grants, or production access. Retries and late deliveries remain isolated even after test checkout is switched off. Live deliveries continue to work while the test switch is on. Unknown/mismatched signatures or modes receive 400 with no database access.

The portal remains live-only, using the live subscription and customer scope. The existing `useBillingStatus` hook already filters account records to `betstreaks`; regression tests cover sandbox-only and mixed records. Sandbox subscription rows are also excluded from live duplicate-subscription and premium-preservation checks.

Raw Stripe/database error messages and checkout session IDs are not emitted by checkout diagnostics. Presence booleans, scope, stage, and allowlisted Stripe error types/codes remain available. No environment files or deployed secrets are changed.

## Files

- `_shared/stripeAccounts.ts`: scope definitions, complete account configuration, fail-closed selection.
- `_shared/stripeWebhookHandlers.ts`: sandbox-only customer handling and no production entitlement writes.
- `create-checkout-session/{index,handler}.ts`: unconditional server entrypoint and testable request handler; scoped lookup/persistence, price and session safeguards, safe diagnostics.
- `stripe-webhook/{index,handler}.ts`: unconditional server entrypoint and testable request/store; verified mode/scope routing.
- `create-portal-session/{index,handler}.ts`: unconditional server entrypoint and testable request handler; live-only portal filtering.
- Backend request tests, shared in-memory database fixtures, account/handler regressions, and `src/hooks/useBillingStatus.test.ts`.

Backend paths above are relative to `supabase/functions/`. The thin entrypoints always register the HTTP server; tests import handlers without starting a server.

## Database

No new migration is required by the repository schema. Migration `20260915193920_e88cb94d-fcbd-427c-b649-5390974f88b3.sql` defines `stripe_account` as unrestricted text with unique keys `(user_id, stripe_account)` and `(stripe_account, stripe_customer_id)`. This supports `betstreaks_test` directly. The deployed schema could not be inspected with the current CLI credentials. Existing live mappings or entitlements possibly affected by previous test deliveries are not automatically repaired by this change.

## Validation

The request tests use mocked Stripe API clients, an in-memory database that applies actual scope filters and upsert conflict keys, and real Stripe SDK HMAC signature verification for webhook requests. They do not create real Stripe sessions or access Supabase data.

Run from the repository root:

```sh
npm exec --yes --package=deno@2.9.6 -- deno test --no-lock supabase/functions
npm exec --yes --package=deno@2.9.6 -- deno check --no-lock supabase/functions/create-checkout-session/index.ts supabase/functions/stripe-webhook/index.ts supabase/functions/create-portal-session/index.ts
npm test
./node_modules/.bin/tsc -p tsconfig.app.json --noEmit
./node_modules/.bin/tsc -p tsconfig.node.json --noEmit
npm run build
npm run lint
```

Targeted checkout/webhook tests and the WeeklyPassCard/billing-hook tests were run before the broader suite. The final backend suite has 104 tests; the frontend suite has 24. Frontend TypeScript checks and the production build pass. Build emits an existing large-bundle warning. Repository-wide ESLint has the same pre-existing 271 errors and 11 warnings as before this fix; this is not a clean global lint run. Focused lint passes for the checkout/portal/webhook request code, account selection, new fixtures/tests, and billing hook tests. The shared webhook handler retains its pre-existing `no-explicit-any` finding.

## Deployment plan — not executed

The checkout used for this fix is `/Users/dwightoffice/Documents/New project/betstreaks-live`, remote `Tjmike50/betstreaks`. The requested `~/betstreaks` path does not exist on this machine. Work is on `fix/stripe-test-customer-isolation`; local main was not rewritten. The pre-existing untracked `STRIPE_SETUP_STATUS.md` is excluded from this fix.

The only checked-in GitHub workflow refreshes sports data; no checked-in Edge Function deployment workflow was found. Do not assume a Git push deploys these functions. Supabase CLI 2.109.1 is installed, but its current credentials cannot access configured project `enhksxikgvvdohseivpx` or list that project's functions. Deployment needs credentials with access to that project.

After reviewing this fix and authorizing deployment, authenticate to the correct Supabase account and verify project access. Redeploy **all three functions** below. Shared modules are bundled into these deployments; there is no separate shared-module deployment. Deploy the webhook first so existing test deliveries cannot affect live billing, then the portal and checkout:

```sh
cd '/Users/dwightoffice/Documents/New project/betstreaks-live'
supabase functions deploy stripe-webhook --project-ref enhksxikgvvdohseivpx --use-api --no-verify-jwt
supabase functions deploy create-portal-session --project-ref enhksxikgvvdohseivpx --use-api --no-verify-jwt
supabase functions deploy create-checkout-session --project-ref enhksxikgvvdohseivpx --use-api --no-verify-jwt
```

The JWT flags match existing `supabase/config.toml`. Checkout and portal retain their in-handler user authentication; the webhook verifies Stripe signatures. Do not run a database push or change/remove live secrets. Keep the existing four test variables in Supabase's secret store. No frontend deployment is needed for this fix.

## Sandbox smoke test and remaining limits

1. With the deployed test switch enabled, sign in as the existing user with a live customer mapping and choose a Weekly Pass quantity, for example 9 weeks ($45).
2. Start a fresh checkout. Verify in the sandbox Dashboard that the new session ID is `cs_test_...`, `livemode=false`, the line item uses the test Weekly Pass price, and quantity is 9. A real `cs_test_` session has **not** been created by this local test run.
3. Confirm that `stripe_account_customers` contains separate `betstreaks` and `betstreaks_test` rows for that user, with the original live mapping unchanged.
4. Complete payment with Stripe's documented test payment details. Confirm successful sandbox payment and a webhook result of `sandbox_customer_recorded`. Check that production subscription rows, flags, and Weekly Pass grants remain unchanged.
5. Start another sandbox checkout and confirm it reuses the same sandbox customer.
6. The unchanged success URL returns to the current production entitlement confirmation UI. Because sandbox payments deliberately do not grant production premium, that page can show a pending/failed confirmation after a successful test payment. Judge this test by the sandbox payment and webhook, not production access activation. The live-only billing portal still manages real subscriptions.
7. When testing is finished, restore `STRIPE_TEST_MODE=false` through the existing secure secret-management process. No live credentials need changing. Delayed sandbox webhooks remain isolated. Do not complete a live payment as part of this sandbox smoke test.

Stripe references: [testing](https://docs.stripe.com/testing) and [API authentication](https://docs.stripe.com/api/authentication). Sandbox entitlements and a separate sandbox success UI are intentionally outside this customer-isolation fix.
