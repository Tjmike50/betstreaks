

## Add Moneyline, Spread, Totals, and Combo Bets to AI Bet Builder

### Problem
The edge function fetches game-level odds (h2h, spreads, totals) from the Odds API but discards them. Only player props are used as slip legs. The `betType` filter in the UI is cosmetic.

### What Changes

**1. Parse game-level markets into candidate legs** (edge function)
- After fetching `h2h,spreads,totals` from the Odds API (already happening on line 447), parse them into a structured format similar to player prop candidates:
  - **Moneyline**: `{ type: "moneyline", team: "BOS", odds: "-180", opponent: "LAL", label: "Celtics ML" }`
  - **Spread**: `{ type: "spread", team: "BOS", spread: -4.5, odds: "-110", opponent: "LAL" }`
  - **Totals**: `{ type: "total", game: "BOS vs LAL", line: 220.5, pick: "Over", odds: "-110" }`
- Aggregate best lines across sportsbooks (same multi-book logic already used for props)

**2. Include game-level candidates in the LLM prompt** (edge function)
- Add a `GAME-LEVEL CANDIDATES` section to the system prompt alongside the existing `SCORED CANDIDATES`
- Update the LLM instructions to allow selecting from both pools
- Update the JSON schema to accept `stat_type` values like `"Moneyline"`, `"Spread"`, `"Total"`

**3. Respect the `betType` filter** (edge function)
- `"player_props"` → only send player prop candidates (current behavior)
- `"moneyline"` → only send moneyline candidates
- `"spread"` → only send spread candidates
- `"totals"` → only send totals candidates
- `"mixed"` / `null` → send all candidate types (combo bets)

**4. Update validation layer** (edge function)
- Currently validation only matches against `player_prop_scores`. Game-level legs need a separate validation path that checks against the parsed Odds API data
- Add validation keys for game-level bets: `team|moneyline`, `team|spread|line`, `game|total|line`

**5. Update slip leg types** (frontend)
- Extend `AISlipLeg` type to handle game-level bets (player_name becomes team name for ML/spread, or "Game Total" for totals)
- Update slip card rendering to display game-level legs differently (show team logos, spread values, etc.)

**6. Snapshot fallback for game-level bets**
- Currently `line_snapshots` only stores player props. Either:
  - Add game-level odds to `line_snapshots` (new rows with `stat_type` = "Moneyline"/"Spread"/"Total"), or
  - Create a separate `game_odds_snapshots` table

### Technical Details

**Edge function changes** (`supabase/functions/ai-bet-builder/index.ts`):
- Lines ~447-455: Already fetches `h2h,spreads,totals` — add parsing logic after this block
- Lines ~575-578: `oddsSummary` already extracts game info — expand to include parsed odds
- Lines ~581-638: Add game-level candidates to the prompt alongside player props
- Lines ~655-710: Update system prompt to instruct LLM about game-level bet types
- Validation section: Add game-level leg validation (separate from player prop matching)

**New DB table** (migration):
- `game_odds_snapshots`: `id, game_date, home_team, away_team, market_type (h2h/spread/total), line, home_odds, away_odds, over_odds, under_odds, sportsbook, snapshot_at`

**Frontend changes**:
- `src/types/aiSlip.ts`: Add optional `bet_type` field to `AISlipLeg`
- Slip card component: Render game-level legs with appropriate labels (team name + spread, "Game Total O/U", etc.)

### Files Modified
- `supabase/functions/ai-bet-builder/index.ts` — main logic changes
- `src/types/aiSlip.ts` — leg type extension
- New migration for `game_odds_snapshots` table
- Slip display components (wherever legs are rendered)

