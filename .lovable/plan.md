
# Plan: Make Alerts Page Premium-Only

## Overview
Transform the Alerts page into a premium-gated feature. Non-premium users (including logged-out users) will see a visually appealing lock screen with a preview of alerts and a call-to-action to upgrade. Premium users will have full access.

## Current State
- **AlertsPage**: Currently shows all alerts to everyone, with only "Push notifications" marked as premium
- **usePremiumStatus hook**: Returns `isPremium: false` for all users (placeholder for future implementation)
- **PremiumLockModal**: Exists for waitlist signup but doesn't fully gate the page
- **FavoritesPage**: Shows a pattern for unauthenticated users (login prompt) but not full premium gating

## Implementation Approach

### 1. Create a PremiumLockedScreen Component
A new reusable component for premium-locked pages that displays:
- Lock icon with "Premium" badge
- Title explaining the feature is premium
- Value proposition text
- Blurred/preview of sample alerts
- "Upgrade to Premium" button (links to /premium page)
- "Back to Home" link
- Inline waitlist signup option

**File**: `src/components/PremiumLockedScreen.tsx`

### 2. Update AlertsPage
Modify the Alerts page to:
- Import and use `usePremiumStatus` hook
- Show loading skeleton while checking premium status
- Render `PremiumLockedScreen` if user is not premium
- Keep existing alerts functionality for premium users

**File**: `src/pages/AlertsPage.tsx`

### 3. Update usePremiumStatus Hook (Optional Enhancement)
The hook is already set up as a placeholder. No changes needed now - when you implement Stripe subscriptions later, you'll update this hook to check actual premium status.

## Technical Details

### PremiumLockedScreen Component
```text
+------------------------------------------+
|               [Lock Icon]                 |
|          "Alerts are Premium"             |
|                                           |
|   Unlock real-time streak alerts and      |
|   "new streak" signals.                   |
|                                           |
|   [Upgrade to Premium Button]             |
|   [Back to Home Link]                     |
|                                           |
|   ---- Preview ----                       |
|   [Blurred sample alert cards]            |
|   [Blurred sample alert cards]            |
|   [Blurred sample alert cards]            |
+------------------------------------------+
```

### AlertsPage Flow
```text
Loading? -> Show Skeleton
Not Premium? -> Show PremiumLockedScreen
Premium? -> Show Full Alerts List (existing code)
```

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `src/components/PremiumLockedScreen.tsx` | Create | New reusable component for premium-locked pages |
| `src/pages/AlertsPage.tsx` | Modify | Add premium check and conditional rendering |

## Notes
- This follows the existing pattern of using `usePremiumStatus` which currently returns `isPremium: false`
- When you later implement Stripe payments, updating the `usePremiumStatus` hook will automatically unlock the Alerts page for paying users
- The preview section shows blurred placeholder cards to give users a taste of what they're missing
- Uses existing UI components (Button, Card, Skeleton) to maintain consistency
