

# Plan: Fix Sample Size, Non-Playing Players, and Team Dropdown

## Three Issues to Address

### 1. Sample Size — Why Not Full Season?
The system **is** using full-season data when available. The `player_recent_games` table stores all game logs fetched by `refresh.py`. The scoring engine (`prop-scoring-engine`) uses ALL logs in the table for each player — there's no artificial cap. The "4 game sample" issue was caused by bad refresh runs where the NBA API returned partial data, overwriting full-season logs. The quality gate (median < 10 check) already protects against this. No code changes needed here — the fix is in the refresh script (running on your Mac mini), which needs a safety check to not overwrite when fewer rows are returned. That's a Python script change outside Lovable's scope, but we can add a visible warning in the UI when sample sizes are low.

### 2. Players Not Playing Tonight / Bets Not on Sportsbook
The today-games filter (Phase 2a-ii) correctly removes prop candidates from non-playing teams. However, game-level candidates (ML, spread, totals) from the Odds API can include games that haven't started or teams the user doesn't care about. The real issue is the **LLM occasionally hallucinating or selecting candidates that don't pass validation but still get through** due to fuzzy matching being too lenient. Fixes:
- **Stricter validation**: After validation, verify each player prop leg's `team_abbr` is in `teamsPlayingToday`. Currently only the candidate pool is filtered, but the LLM could reference a player name that fuzzy-matches to a wrong candidate.
- **Require live odds match**: Add a flag to reject player prop legs where no live odds were found (currently shows "Odds unverified" but still includes the leg).
- **Filter stale availability**: Check `player_availability` for "out" status and reject those legs.

### 3. Team Filter — Dropdown Instead of Text Input
Replace the `TagInput` for "Include Teams" and "Exclude Teams" in `BuilderFilterPanel.tsx` with a multi-select dropdown showing all 30 NBA teams. Use the existing `nbaTeamMeta.ts` data for team names and abbreviations.

---

## Implementation Details

### A. Team Dropdown Component (`BuilderFilterPanel.tsx`)
- Replace the two `TagInput` components for Include/Exclude Teams with a new `TeamMultiSelect` component.
- Uses a `DropdownMenu` with checkboxes showing all 30 teams as `"{City} {Name} ({ABBR})"` (e.g., "Los Angeles Lakers (LAL)").
- Selected teams appear as removable badges below the dropdown trigger.
- Import team list from `nbaTeamMeta.ts`.

### B. Stricter Validation in Edge Function (`ai-bet-builder/index.ts`)
- After player prop validation (Phase 5), add a post-validation check: if the validated candidate's `team_abbr` is not in `teamsPlayingToday`, reject the leg.
- When `bestLine` is not found for a player prop AND the `avoidStaleAvailability` or `requireFreshMarketData` filter is on, reject the leg (currently it just marks `odds_validated: false`).
- Check `player_availability` table for "out" status on today's date — reject any leg where the player is listed as "out".

### C. Low Sample Warning in UI (`AIBetBuilderPage.tsx`)
- In `LegDataBar`, if `sample_size < 15`, show a warning badge "Low sample" in amber to flag potentially unreliable data to users.

