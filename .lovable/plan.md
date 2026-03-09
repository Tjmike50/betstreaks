

# Add Visible Tier Badge to Account Page

## Overview
Add a prominent "Free Plan" or "Premium" tier badge directly below the user's email address on the Account page, making subscription status immediately visible without scrolling.

---

## Current State

The Account page shows:
1. User avatar icon
2. "Logged in" heading
3. Email address
4. Feature list
5. Premium card (further down - easy to miss)

Users must scroll to the premium card section to understand their tier status.

---

## Solution

Add a colored badge directly below the email that shows:

| Status | Badge Display |
|--------|---------------|
| Loading | Gray spinner badge |
| Free | "Free Plan" - neutral gray badge |
| Premium | "Premium" - green badge with check icon |

---

## Visual Design

**Free Plan Badge:**
```
┌─────────────────────────────────┐
│        [User Avatar]            │
│         Logged in               │
│      user@example.com           │
│      ┌──────────────┐           │
│      │  Free Plan   │  ← Gray   │
│      └──────────────┘           │
└─────────────────────────────────┘
```

**Premium Badge:**
```
┌─────────────────────────────────┐
│        [User Avatar]            │
│         Logged in               │
│      user@example.com           │
│      ┌────────────────┐         │
│      │ ✓ Premium      │ ← Green │
│      └────────────────┘         │
└─────────────────────────────────┘
```

---

## Implementation

### File: `src/pages/AccountPage.tsx`

**Add tier badge component inline** (lines 207-214):

```tsx
<div className="text-center space-y-2">
  <h2 className="text-lg font-semibold text-foreground">
    Logged in
  </h2>
  <p className="text-sm text-muted-foreground break-all">
    {user.email}
  </p>
  
  {/* NEW: Tier Badge */}
  {isPremiumLoading ? (
    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-muted text-muted-foreground text-xs font-medium">
      <Loader2 className="h-3 w-3 animate-spin" />
      Checking...
    </span>
  ) : isPremium ? (
    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-green-500/20 text-green-500 text-xs font-medium">
      <Check className="h-3 w-3" />
      Premium
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-muted text-muted-foreground text-xs font-medium">
      Free Plan
    </span>
  )}
</div>
```

---

## Summary

| Change | Description |
|--------|-------------|
| Add tier badge | Colored pill badge showing "Free Plan" or "Premium" with icon |
| Position | Directly below email address for immediate visibility |
| States | Loading (spinner), Free (gray), Premium (green + check) |

**Files Modified:** `src/pages/AccountPage.tsx`

This makes subscription tier instantly visible at the top of the Account page, so users always know whether they're on Free or Premium without scrolling.

