

## Overview

This plan removes all Premium waitlist functionality and creates a cleaner Premium experience with direct Stripe checkout integration. The Premium page will be more prominently accessible and clearly communicate the value proposition with subscription options.

---

## Summary of Changes

### Files to Delete
- `src/hooks/usePremiumWaitlist.ts` - No longer needed

### Files to Modify Significantly 
1. **`src/components/PremiumLockModal.tsx`** - Convert from waitlist signup to direct Premium upgrade modal
2. **`src/pages/AccountPage.tsx`** - Update Premium teaser card (remove "Coming Soon" and "Join waitlist")
3. **`src/pages/PremiumPage.tsx`** - Update features list and pricing display ($10/mo to match spec)
4. **`src/pages/PrivacyPage.tsx`** - Remove waitlist reference from privacy content

### Files with No Changes Needed
- `src/components/BottomNav.tsx` - Premium is already accessible via Account; no new tab needed per current design
- `src/components/PremiumLockedScreen.tsx` - Already properly configured with features and pricing
- `src/App.tsx` - Route `/premium` already exists

---

## Detailed Changes

### 1. Delete Waitlist Hook
Remove `src/hooks/usePremiumWaitlist.ts` entirely - it's no longer used anywhere after this refactor.

### 2. Convert PremiumLockModal to Upgrade Modal
**Current behavior:** Collects email for waitlist, inserts into `premium_waitlist` table
**New behavior:** Shows Premium benefits with upgrade/login button that navigates to `/premium`

The modal will:
- Display the Premium feature list (matching the user's requirements)
- Show pricing ($10/mo, $60/yr)
- For logged-in users: Show "Upgrade to Premium" button linking to `/premium`
- For logged-out users: Show "Log in to Upgrade" button linking to `/auth`
- Remove all email input and waitlist submission logic

### 3. Update AccountPage Premium Teaser
**Current state:** Shows "Go Premium" with "Coming Soon" and "Join waitlist" button
**New state:** Shows "Go Premium" with pricing info and "Upgrade" or "Manage Subscription" button

For logged-in users:
- If Premium: Show "You are Premium" with checkmark and "Manage Subscription" button
- If not Premium: Show "Go Premium" with pricing and "Upgrade" button

For logged-out users:
- Show "Go Premium" with "Log in to upgrade" messaging

### 4. Update PremiumPage Features List
Expand the features list to match the user's requirements:
1. Player combos (PTS+AST, PTS+REB, PRA, etc.)
2. Last 10 / 15 / 20 game splits
3. Alerts tab (streak alerts)
4. Best plays of the day (AI ranked)
5. Save favorite players
6. Double-Double & Triple-Double tracking
7. Historical matchup trends

Also update pricing display:
- Monthly: $10/month (currently shows $9.99)
- Yearly: $60/year (currently shows $59.99)

### 5. Update PrivacyPage
Remove waitlist reference from the "Information We Collect" section:
- Change: "Email address (account creation or premium waitlist)"
- To: "Email address (account creation)"

---

## Technical Notes

### Database Consideration
The `premium_waitlist` Supabase table will remain in the database but won't be used by the app. This is safe since:
- No new entries will be written
- Existing data is preserved for historical reference
- The table can be dropped later via a migration if desired

### localStorage Cleanup
The `joined_waitlist` localStorage key will no longer be set or read. Existing values are harmless and will be ignored.

### Components Using PremiumLockModal
These components will continue to work with the updated modal:
- `RecentGamesList.tsx`
- `StreakCard.tsx`
- `FilterBar.tsx`
- `AlertsPage.tsx`
- `StreakStats.tsx`
- `WatchlistPage.tsx`
- `PlayerPage.tsx`

