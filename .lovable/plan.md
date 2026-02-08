
# Fix Today Page Reliability

## Problem
The Today page can show blank/empty blocks in certain conditions, which undermines user trust for a paid MVP.

## Current State Analysis
After inspection, the page structure is mostly correct:
- **Loading state**: Shows 5 skeleton cards (no text)
- **Error state**: Shows "Failed to load games" with Retry button
- **Empty state**: Shows "No games scheduled" with refresh info
- **Success state**: Shows game cards with teams, scores, status

However, improvements are needed to guarantee the page never looks "broken."

---

## Implementation Plan

### 1. Enhance Loading State (TodayPage.tsx)
Add descriptive text to skeletons so users know content is loading.

```text
Current:
  <Skeleton /> x5 (no text)

Improved:
  <div>
    <p>Loading today's games...</p>
    <Skeleton /> x5
  </div>
```

### 2. Improve Empty State with Date Context
Show today's date so users understand what day the "no games" message refers to.

```text
Current:
  "No games scheduled"
  "Last refresh: 5m ago"

Improved:
  "No NBA games scheduled for Saturday, Feb 8"
  "Last updated: 5m ago • 2025–26 Season"
```

### 3. Add Debug Indicator
When `?debug=1` query param is present, show debugging info.

| Field | Value |
|-------|-------|
| Records fetched | 10 |
| Date range | 2026-02-07 to 2026-02-09 |
| Last updated | 2026-02-08T09:00:06Z |

### 4. Ensure GameCard Never Renders Empty
The GameCard already handles null team abbreviations gracefully (shows "TBD"), but the hook filters these out. Add a safety check in the page to log if any slip through.

---

## File Changes

### `src/pages/TodayPage.tsx`
| Change | Description |
|--------|-------------|
| Add loading text | Show "Loading today's games..." above skeletons |
| Add today's date | Format and display current date in empty state |
| Add debug panel | Show record count, date range, timestamps when `?debug=1` |
| Import useSearchParams | Needed to read query params |

### `src/hooks/useGamesToday.ts`
| Change | Description |
|--------|-------------|
| Export debug info | Return `debugInfo` object with startDate, endDate, rawCount |

---

## Code Changes Detail

### TodayPage.tsx Updates

**Add imports:**
```typescript
import { useSearchParams } from "react-router-dom";
import { format } from "date-fns";
```

**Add debug detection:**
```typescript
const [searchParams] = useSearchParams();
const isDebug = searchParams.get("debug") === "1";
const todayFormatted = format(new Date(), "EEEE, MMM d");
```

**Enhanced loading state:**
```tsx
{isLoading ? (
  <div className="space-y-3">
    <p className="text-sm text-muted-foreground text-center py-2">
      Loading today's games...
    </p>
    {[...Array(5)].map((_, i) => (
      <Skeleton key={i} className="h-20 w-full rounded-lg" />
    ))}
  </div>
)
```

**Enhanced empty state:**
```tsx
: games.length === 0 ? (
  <div className="flex flex-col items-center justify-center py-16 text-center">
    <Calendar className="h-12 w-12 text-muted-foreground mb-4" />
    <p className="text-lg font-medium">
      No NBA games scheduled
    </p>
    <p className="text-sm text-muted-foreground mt-1">
      for {todayFormatted}
    </p>
    ...
  </div>
)
```

**Add debug panel (dev-only):**
```tsx
{isDebug && (
  <div className="mt-4 p-3 bg-muted/50 rounded-lg text-xs font-mono">
    <p className="font-semibold mb-1">Debug Info</p>
    <p>Records: {games.length} (raw: {debugInfo.rawCount})</p>
    <p>Date range: {debugInfo.startDate} to {debugInfo.endDate}</p>
    <p>Last updated: {lastUpdated?.toISOString() || "N/A"}</p>
  </div>
)}
```

### useGamesToday.ts Updates

**Add debug info to return:**
```typescript
const debugInfo = {
  startDate,
  endDate,
  rawCount: data?.length ?? 0,
};

return {
  games: data ?? [],
  isLoading,
  isFetching,
  error,
  lastUpdated: data?.length ? lastUpdated : null,
  refetch: handleRefresh,
  debugInfo, // NEW
};
```

---

## Testing Acceptance Criteria

| State | What User Sees |
|-------|----------------|
| **Loading** | "Loading today's games..." + skeleton cards |
| **Success** | List of game cards with teams, scores, times |
| **Empty** | "No NBA games scheduled for [today's date]" + refresh button |
| **Error** | "Couldn't load today's games" + Retry button |
| **Debug** | All above + debug panel with record counts and timestamps |

---

## Summary

| File | Changes |
|------|---------|
| `src/pages/TodayPage.tsx` | Add loading text, date in empty state, debug panel |
| `src/hooks/useGamesToday.ts` | Export debugInfo with date range and counts |

This ensures the Today page always displays meaningful content and never shows blank blocks.
