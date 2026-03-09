

## Problem

Yesterday's (March 8) games have stale statuses in the database -- they show "1st Qtr", "2nd Qtr", "3rd Qtr", "10:00 pm ET" instead of "Final" because the refresh script didn't update them. The current client-side filter in `useGamesToday.ts` only hides yesterday's games if their status contains "final", so these 5 stale games appear on the Today page alongside today's upcoming games.

## Fix

**File: `src/hooks/useGamesToday.ts`** -- Change the yesterday filter logic to use a time-based cutoff instead of relying on the status field.

Current logic (line 56-59):
```ts
if (game.game_date >= todayStr) return true;
const status = (game.status || "").toLowerCase();
return !status.includes("final");
```

New logic:
- If the game is from yesterday and the current local time is past **6 AM**, hide it regardless of status. By 6 AM, all NBA games from the prior day are guaranteed to be over.
- If it's before 6 AM (late-night window), keep yesterday's games only if they appear to be in-progress (status contains "qtr", "half", "ot") -- not if they're scheduled or final.

This handles two scenarios:
1. **Normal case (after 6 AM):** Only show today's and tomorrow's games.
2. **Late-night case (before 6 AM):** Show yesterday's genuinely live games for users checking scores after midnight.

No database or edge function changes needed -- this is a pure client-side filter fix.

