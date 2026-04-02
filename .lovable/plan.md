# BetStreaks Phase 4 — Monetization, Polish & Launch Readiness

## Status: PLANNING

---

## Phase 4 Sections

### 4.1 — Premium Gating Audit

Verify every premium-gated feature works correctly end-to-end.

| Check | Criteria | PASS/FAIL |
|-------|----------|-----------|
| Combo streaks locked for free users | Teaser cards shown, tap triggers upsell modal | |
| Advanced splits locked (L10/L15/L20) | Lock icons shown, tap triggers modal | |
| Favorites gated | Heart icon triggers premium modal for free users | |
| Alerts page gated | PremiumLockedScreen renders for free users | |
| AI Builder daily limit enforced | Free users limited to 1/day, premium unlimited | |
| AI Analyzer daily limit enforced | Same gating as builder | |
| Premium modal shows correct pricing | $10/mo, $60/yr visible | |
| Modal CTA routes correctly | Logged-out → /auth, logged-in → /premium | |
| Game history limited for free users | Only 5 recent games visible | |

**PASS criteria:** All 9 checks verified on both logged-out and free-tier accounts.

---

### 4.2 — Pricing / Paywall Flow

End-to-end Stripe checkout and billing management.

| Check | Criteria | PASS/FAIL |
|-------|----------|-----------|
| Monthly checkout creates Stripe session | Redirects to Stripe, correct price_id | |
| Yearly checkout creates Stripe session | Redirects to Stripe, correct price_id | |
| Success redirect sets is_premium = true | user_flags updated via webhook | |
| Cancel redirect shows toast | No subscription created | |
| Manage Billing opens Stripe portal | Portal session created and redirected | |
| Webhook handles subscription.updated | Status changes reflected in user_flags | |
| Webhook handles subscription.deleted | is_premium set to false | |
| Premium page shows correct state | 3 states: logged-out, free, premium | |

**PASS criteria:** Full purchase → activate → cancel lifecycle tested with Stripe test mode.

---

### 4.3 — AI Builder UX Polish

| Check | Criteria | PASS/FAIL |
|-------|----------|-----------|
| Builder filters render without overflow | All chips/badges fit on mobile viewport | |
| Slip result cards are scannable | Name, legs, odds, risk label, reasoning visible | |
| Empty state is helpful | Clear prompt suggestions when no slips generated | |
| Error states handled | Network errors, rate limits show user-friendly messages | |
| Loading state smooth | Skeleton or spinner during generation | |
| Market quality badges visible on legs | Verified, books count, edge shown where available | |

**PASS criteria:** Builder usable end-to-end on 375px mobile viewport with no layout breaks.

---

### 4.4 — Saved Slips / Favorites UX

| Check | Criteria | PASS/FAIL |
|-------|----------|-----------|
| Save slip works | Tap save → slip appears in Saved Slips page | |
| Unsave slip works | Tap again → removed from saved list | |
| Saved Slips page loads | Shows all saved slips with legs | |
| Favorite players page loads | Shows favorited players with links to detail | |
| Empty states present | Both pages show helpful empty state when no items | |
| Premium gating on favorites | Free users see upsell when trying to favorite | |

**PASS criteria:** Save/unsave round-trip works; empty states render; gating enforced.

---

### 4.5 — Onboarding / Empty States

| Check | Criteria | PASS/FAIL |
|-------|----------|-----------|
| Home page with no streaks | Shows helpful message, not blank | |
| Today page with no games | Shows "No games today" state | |
| Watchlist empty state | Shows prompt to add items | |
| Alerts empty state | Shows explanation of what alerts do | |
| Builder empty state | Shows prompt suggestions | |
| Player page 404 handling | Graceful error for invalid player_id | |
| First-visit onboarding | OnboardingFlow renders for new users | |

**PASS criteria:** No blank/broken screens on any page when data is empty.

---

### 4.6 — Trust / Verified Market Messaging

| Check | Criteria | PASS/FAIL |
|-------|----------|-----------|
| No "guaranteed" / "lock" language anywhere | Audit all user-facing copy | |
| Risk labels use approved terms | safe / balanced / aggressive only | |
| AI disclaimers present | Builder and Analyzer show "not financial advice" | |
| Responsible Gambling page exists and links | Footer link works | |
| Verified badge only shown when multi-book | No false "verified" on single-book props | |
| Data freshness indicator visible | Users can see when data was last updated | |

**PASS criteria:** All user-facing language is compliant and defensible.

---

### 4.7 — Admin Cleanup

| Check | Criteria | PASS/FAIL |
|-------|----------|-----------|
| Admin pages not accessible to non-admins | Route protection via is_admin check | |
| Admin nav not visible to regular users | No admin links in non-admin UI | |
| Slip Validation Review functional | All Phase 3 sections render with real data | |
| Eval page loads without errors | No console errors on /admin/eval | |
| Refresh button works | Admin can trigger data refresh | |

**PASS criteria:** Admin features isolated and functional.

---

### 4.8 — Production Readiness Checklist

| Check | Criteria | PASS/FAIL |
|-------|----------|-----------|
| No console.log in production paths | Only error/warn logging | |
| SEO meta tags on key pages | Title, description on Index, Premium, Auth | |
| robots.txt configured | Allows crawling of public pages | |
| Error boundaries present | App doesn't white-screen on component errors | |
| Mobile responsive on all pages | No horizontal scroll on 375px | |
| Dark mode consistent | All pages render correctly in dark mode | |
| Loading states on all data fetches | No content flash or layout shift | |
| 404 page works | /random-path shows NotFound page | |
| Auth redirect flows work | Protected routes redirect to /auth | |
| Stripe in live mode | Test keys swapped to production keys | |
| Edge functions deployed | All functions accessible and responding | |
| RLS policies in place | All tables with user data have RLS enabled | |

**PASS criteria:** All 12 checks pass before public launch.

---

## Launch Blockers (MUST fix before public launch)

1. Stripe live-mode keys configured and webhook verified
2. Premium gating works on all gated features
3. No "guaranteed" or "lock" language in UI
4. Responsible Gambling page accessible
5. Auth flows work (signup, login, logout, redirect)
6. Mobile responsive on core pages (Home, Today, Builder, Premium)
7. Empty states on all pages (no blank screens)
8. RLS policies on all user-data tables
9. Edge functions deployed and responding

## Nice to Have Later (Post-Launch)

1. Push notification alerts for streak events
2. Social sharing of slips
3. Leaderboard / community features
4. Advanced historical charting on player pages
5. Multi-sport expansion (NFL, MLB)
6. Referral program
7. Dark/light mode toggle in settings
8. PWA / installable app
9. Email digest of daily best plays
10. A/B testing on premium conversion

---

## Recommended Build Order

### Sprint 1 — Launch Blockers (build first)
1. Premium gating audit (4.1)
2. Pricing/paywall flow verification (4.2)
3. Trust/messaging audit (4.6)
4. Production readiness checklist (4.8)

### Sprint 2 — UX Polish (build second)
5. Onboarding/empty states (4.5)
6. AI Builder UX polish (4.3)
7. Saved slips/favorites UX (4.4)

### Sprint 3 — Cleanup (can wait until after soft launch)
8. Admin cleanup (4.7)

---

## Fastest Path to Public Launch

**Critical path:** 4.1 → 4.2 → 4.6 → 4.8

These four sections ensure money can be collected safely, features are properly gated, messaging is compliant, and the app won't break in production. Everything else is polish that can ship iteratively after a soft launch.

**Estimated effort:** Sprint 1 is mostly verification and minor fixes. Sprint 2 is UI work. Neither requires new backend architecture.
