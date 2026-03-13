

## Plan: Fix Scoring Stats, Verify Market Depth, Add 402 Fallback

### Three Issues Identified

**Issue 1: Confidence, Value, Szn Avg, Volatility show dashes**

Root cause: `player_prop_scores` table has **zero rows** for today (2026-03-13). The edge function enriches candidates from this table (lines 648-678), but when empty, all scoring fields (`confidence_score`, `value_score`, `season_avg`, `volatility_score`) are null. The `LegDataBar` component correctly renders "—" for null values.

This is a **data pipeline issue** — the `prop-scoring-engine` edge function hasn't been run today. The fix is to trigger it, but we should also make the UI graceful when scoring data is missing.

**Issue 2: Market Depth Summary**

Code review confirms the `MarketDepthSummary` component renders correctly at line 541 of `AIBetBuilderPage.tsx`, gated on `marketDepth` being truthy. The hook captures it from `data.scoring_metadata` and `data.debug`. This should be working — the `scoring_metadata` field is always returned in the success response (line 1474). No code fix needed here.

**Issue 3: 402 Fallback — return top candidates without LLM**

When the AI gateway returns 402 (line 1187-1189), the function currently returns an error immediately, even though it has already scored and ranked all candidates. We should build slips deterministically from the top candidates.

---

### Changes

#### 1. Edge Function: Add deterministic fallback slip builder (`supabase/functions/ai-bet-builder/index.ts`)

After the 402 check at line 1187, instead of returning an error, build slips programmatically:

- Add a `buildFallbackSlips()` function that takes the top diversified candidates and game-level candidates, groups them into slips by sorting on `confidence_score` (desc) then `market_confidence` (desc)
- Each slip gets `legCount` legs (from filters or default 3), picks the best side (over/under) based on edge, and builds `data_context` identically to the LLM path
- Sets `slip_name` to "Data-Driven Picks" with a risk label based on average confidence
- Sets `reasoning` to explain this is a fallback without AI formatting
- Saves to DB same as LLM path, returns with a `fallback: true` flag in the response
- Applies to both 402 and 429 status codes from the AI gateway

#### 2. Hook: Surface fallback flag (`src/hooks/useAIBetBuilder.ts`)

- Add `isFallback` boolean state
- Set it from `data.fallback` in the response
- Export it from the hook

#### 3. UI: Show fallback banner and handle missing scoring (`src/pages/AIBetBuilderPage.tsx`)

- When `isFallback` is true, show a subtle info banner above slips: "These picks were built from scored data without AI formatting. Upgrade or try again later for full AI analysis."
- In `LegDataBar`, when all 4 stats are null, show a compact "Scoring data pending" message instead of four dashes

#### 4. Trigger scoring engine for today

- Invoke `prop-scoring-engine` to populate today's `player_prop_scores` so future requests have scoring data

---

### File Summary

| File | Change |
|------|--------|
| `supabase/functions/ai-bet-builder/index.ts` | Add `buildFallbackSlips()` function; use it on 402/429 instead of returning error |
| `src/hooks/useAIBetBuilder.ts` | Add `isFallback` state, capture from response |
| `src/pages/AIBetBuilderPage.tsx` | Add fallback banner; improve `LegDataBar` for missing data |

