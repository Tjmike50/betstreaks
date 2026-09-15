# Roadmap

## Stripe account migration (acct_1UG1iXAHW2dqNeWS "BetStreaks")

- [x] Read-only audit of current payment architecture
- [x] Revise migration to be purely additive (no primary key changes on `stripe_customers`)
- [x] Evidence-based lifetime/manual premium protection (preserve all 7 premium users)
- [x] Shared dual-account config module with activation switch (OFF by default)
- [x] Account-aware checkout, portal, and webhook handling
- [x] New-account price IDs stored as secrets (activation still OFF)
- [x] Regression tests for account routing, duplicate prevention, downgrade protection
- [ ] BLOCKED — waiting on user: add `STRIPE_BETSTREAKS_SECRET_KEY` (restricted key) and
      `STRIPE_BETSTREAKS_WEBHOOK_SECRET` from the new account
- [ ] BLOCKED — waiting on user: set `STRIPE_BETSTREAKS_ACTIVE=true` to flip new checkouts over
- [ ] Not started (intentionally): frontend publish, stale customer cleanup, moving the one
      live legacy subscription
