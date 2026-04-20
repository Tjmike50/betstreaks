

## MLB v1 Polish + Cleanup Pass

### Goals
1. Get `team_abbr`, `opponent_abbr`, `home_away` populated on every MLB scored row so cheatsheets and AI surfaces stop showing blanks.
2. Clean stale junk rows in `games_today` (orphaned hex-ID MLB rows from an earlier ingestion pattern).
3. Make MLB display text resilient (no "?", no empty matchups).
4. Loosen STRIKEOUTS scoring just enough to surface real signal without polluting Daily Pick.
5. Verify Daily Pick + AI Builder still land cleanly with the polished rows.

---

### Phase 1 — Polish + Cleanup

#### 1. Persist MLB TeamID → abbreviation mapping
Currently the abbr map lives in-memory inside `refresh-mlb-data` only. The scorer can't reuse it. Smallest fix: derive the mapping at scoring time from `games_today` (where home/away abbrs already live) joined with `mlb_game_context.game_context_json.home_team_id / away_team_id`.

**File**: `supabase/functions/score-mlb-anchors/index.ts`
- Build `teamIdToAbbr: Map<number, string>` from `(games_today + mlb_game_context)` join.
- For each line being scored, resolve:
  - `team_abbr` ← `teamIdToAbbr.get(profile.mlb_team_id)`
  - The matching today's game (where one of the team_ids equals the player's team_id)
  - `opponent_abbr` ← the other side
  - `home_away` ← `"home"` if player team == home_team_id else `"away"`
- Write all three into the upsert payload (currently they're omitted).

#### 2. Stale `games_today` cleanup
**Migration**: Delete `games_today` rows where `sport='MLB' AND home_team_abbr IS NULL` (the 7 hex-ID orphans). These predate the `mlb_*` ID convention and confuse joins.

#### 3. Backfill team fields on existing MLB scored rows
**Migration**: One-shot UPDATE on `player_prop_scores` for `sport='MLB' AND game_date=CURRENT_DATE` joining `mlb_player_profiles` → `mlb_game_context.game_context_json` → `games_today` to set `team_abbr`, `opponent_abbr`, `home_away`. Lean — single SQL using subqueries. (Future runs handled by the scorer change in step 1.)

#### 4. CheatsheetRowCard text polish
**File**: `src/components/cheatsheets/CheatsheetRowCard.tsx`
- Show `Over {threshold}` cleanly when team is unknown (drop trailing " · ").
- Drop the "?" placeholder anywhere (already uses "—"; tighten matchup formatter to omit the dot when no matchup exists).
- Map `STRIKEOUTS → K`, `EARNED_RUNS_ALLOWED → ER`, `WALKS_ALLOWED → BB`, `HITS_ALLOWED → H Allowed`, `HOME_RUNS → HR`, `TOTAL_BASES → TB` for the badge to fit on mobile (467px viewport).
- Use MLB-aware highlight values: when row.sport='MLB', prefer `score_overall` over legacy `value_score` (so the right-side number is meaningful).

#### 5. Verify Daily Pick + AI Builder
- Run `score-mlb-anchors` after the scorer change to repopulate today's rows with team fields.
- Run `generate-daily-pick {sport:'MLB',force:true}`; confirm legs include team abbrs and matchup text reads cleanly.
- Spot-check AI Builder candidate output via `supabase--curl_edge_functions` on `ai-bet-builder` with a small MLB prompt.

---

### Phase 2 — Highest-ROI MLB Improvements (remaining budget)

#### 6. STRIKEOUTS quality bump
**File**: `supabase/functions/score-mlb-anchors/index.ts`
- Pitchers have small samples in early season (2–3 starts). Current `scoreRecentForm` divides by threshold, harshly punishing K props because `window_l5_avg` for pitchers is computed from only 2–3 starts.
- Smallest fix: when `statKey === "STRIKEOUTS"` AND `sample_size < 5`, blend recent_form with `pitcherSummary.strikeouts_avg` (already loaded) at 50/50 to stabilize.
- Also add a small `strikeouts_avg` matchup boost: combine opp K-rate with the pitcher's own season K-avg vs threshold so high-K pitchers vs high-K offenses tier up.
- Loosen `mlbCandidates.STRIKEOUTS.dailyPickMinOverall` from 60 → 58, but keep `excludeWeakStrikeouts: true` default so they only enter Daily Pick when explicitly enabled.

#### 7. Team mapping reliability
- Already addressed by Phase 1 step 1. Add a defensive log: if `teamIdToAbbr.size < 25`, warn so we catch broken upstreams early.

#### 8. Expansion props — only if signal exists
- No code change needed beyond Phase 1; the per-stat profiles in `_shared/mlbCandidates.ts` already gate HR/BB/ER/H-allowed correctly. Confirm by re-reading current counts after rerun.

---

### Files that will change
- `supabase/functions/score-mlb-anchors/index.ts` (team enrichment + K stabilization)
- `supabase/functions/_shared/mlbCandidates.ts` (small K threshold tweak)
- `src/components/cheatsheets/CheatsheetRowCard.tsx` (display polish, MLB labels)
- One migration: cleanup orphan `games_today` MLB rows + backfill `player_prop_scores` team fields for today.

### Out of scope (intentionally)
- No NHL.
- No park factor / weather modeling.
- No new MLB props.
- No UI redesign of cheatsheets / Daily Pick / AI Builder.
- No reshuffling of scoring axes weights beyond the K stabilization tweak.

### Final report will include
1. Files changed.
2. What was cleaned (orphan games, null team fields, ugly text).
3. What was improved (K stabilization, team mapping).
4. Final per-stat scored + non-pass + AI Builder + Daily Pick counts.
5. Whether Daily Pick legs now display matchup text cleanly.
6. Remaining acceptable rough edges (e.g., HR/BB-allowed sparse on light slates).

