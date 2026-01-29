
# Fix: BLK/STL Stat Filter Not Working

## Problem Identified

After thorough investigation, I discovered that selecting BLK (or STL) from the Stat dropdown does NOT update the filter state. The dropdown shows "All" after selection, and no network request with `stat=eq.BLK` is made.

**Root Cause**: The FilterBar has a "click outside to close" handler. When you click on a dropdown option (rendered in a Radix UI Portal outside the drawer element), the click is detected as "outside" the drawer, triggering `onToggleExpanded()` which closes the drawer. This interrupts or races with the `onValueChange` callback.

## Investigation Summary

- Database confirmed: 65 BLK streaks and 116 STL streaks exist
- Network requests show NO `stat=eq.BLK` filter being applied  
- After selecting BLK, the dropdown reverts to showing "All"
- The drawer closes immediately when clicking dropdown options

## Solution

Modify the "click outside" detection in FilterBar to exclude clicks on Radix UI Portal elements (dropdown content). Radix UI renders Select content with `data-radix-popper-content-wrapper` attribute.

## Technical Changes

### File: `src/components/FilterBar.tsx`

Update the click outside handler to check if the click target is inside a Radix portal:

```typescript
const handleClickOutside = (event: MouseEvent) => {
  const target = event.target as Node;
  
  // Check if click is inside the drawer
  if (drawerRef.current?.contains(target)) {
    return;
  }
  
  // Check if click is inside a Radix portal (dropdowns, etc.)
  const radixPortal = (target as Element).closest?.('[data-radix-popper-content-wrapper]');
  if (radixPortal) {
    return;
  }
  
  onToggleExpanded();
};
```

This change ensures that:
1. Clicks inside the filter drawer don't close it (existing behavior)
2. Clicks on dropdown options (in portals) don't close the drawer (NEW)
3. Clicks truly outside (on the feed, etc.) still close the drawer (existing behavior)
