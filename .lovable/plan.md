
The user is on `/today` and seeing both today's (Apr 18) AND tomorrow's (Apr 19) games. They want only today's games shown.

Looking at `useGamesToday.ts`:
- It fetches a 3-day window: yesterday → today → tomorrow (`getOffsetDateString(today, -1)` to `getOffsetDateString(today, 1)`)
- The filter logic keeps "all of today's and tomorrow's games" (`if (game.game_date >= todayStr) return true`)
- That's why Apr 19 games appear alongside Apr 18 games

The network response confirms it: 6 games returned with `game_date` of either `2026-04-18` or `2026-04-19`, all rendered.

This was likely intentional during early-season/playoffs to show "what's coming up" but the page is titled **"Today's Games"** so showing tomorrow is misleading.

## Plan: Restrict /today to today only

### Change
In `src/hooks/useGamesToday.ts`:
1. Narrow the query window — fetch only `game_date = today` (drop yesterday and tomorrow from the range)
2. Simplify the filter: just keep games where `game_date === todayStr` AND both team abbrs exist
3. Remove the yesterday-carry-over logic (in-progress games from late-night) since the empty state already handles "no games today" gracefully

### Result
- `/today` shows only Apr 18 games (CLE/TOR, DEN/MIN, NYK/ATL, etc.)
- Tomorrow's slate (BOS/PHI, OKC/PHX, DET/ORL) no longer appears here
- `GameSelector` in AI Builder, which uses the same hook, will also narrow to today only — confirm this is desired (AI Builder typically picks games for today's slate, so this aligns)

### Files Changed
| File | Lines | What |
|------|-------|------|
| `src/hooks/useGamesToday.ts` | 28–73 | Window = today only; filter = today + valid teams |

### Note on AI Builder
`GameSelector.tsx` consumes the same `useGamesToday` hook. After this change it will only list today's games. If you want the builder to keep showing tomorrow's slate (so users can build slips ahead of time), I'll add an optional `includeTomorrow` flag to the hook and pass `true` from `GameSelector`. Tell me if you want that — otherwise both surfaces narrow to today.
