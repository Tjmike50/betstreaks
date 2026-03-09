

## Problem

The AI Bet Builder shows wrong odds/stats because of two issues:

1. **Threshold mismatch**: The scoring engine caches props at thresholds computed from game logs (e.g., `O4.5 rebounds`), but live market lines are at different thresholds (e.g., `O6.5 rebounds`). The best-line lookup at line 849 requires an exact `player|stat|threshold` match, so it almost never finds a match. Result: all legs show "Odds unverified" and use LLM-hallucinated odds.

2. **Odds API 401 errors**: The most recent run logged `Odds API error: 401` and `Live props found: 0`, so zero live odds were available at all. This could be an expired/rate-limited API key.

## Fix

### 1. Fuzzy threshold matching for best lines (edge function)

Instead of requiring exact threshold match, find the best line for the same `player|stat` regardless of threshold. When multiple thresholds exist, pick the one closest to the scoring engine's threshold.

**In `ai-bet-builder/index.ts`:**
- Build a secondary index: `Map<string, BestLineEntry[]>` keyed on `player|stat` (no threshold)
- When exact key misses, search the secondary index for the closest threshold
- If the market threshold differs from the scoring engine threshold, update the leg's `line` to use the market threshold (so the user sees realistic lines)
- Add a `market_threshold` field to data_context so the UI can show what the market is actually offering

### 2. Odds API error handling

- Log the full error response body on 401 so we can diagnose
- When Odds API returns 401/403, fall back to the most recent `line_snapshots` from today as a backup odds source
- Build best lines from snapshots when live fetch fails

### 3. UI: Show market line vs scoring line when they differ

**In `AIBetBuilderPage.tsx` / `DataContextChips`:**
- When `data_context.market_threshold` exists and differs from the displayed line, show a chip like "Market line: O6.5" so users know the actual sportsbook line

### Files Changed
- `supabase/functions/ai-bet-builder/index.ts` — fuzzy threshold matching, snapshot fallback for odds
- `src/types/aiSlip.ts` — add `market_threshold` to `LegDataContext`
- `src/pages/AIBetBuilderPage.tsx` — display market line chip when threshold differs

