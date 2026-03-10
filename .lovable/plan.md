

## Increase Candidate Pool from 40 to 100

### What Changes

One-line change in `supabase/functions/ai-bet-builder/index.ts`:

- **Line 19**: Change `MAX_CANDIDATES_TO_LLM` from `40` to `100`
- **Line 20**: Bump `MAX_GAME_CANDIDATES_TO_LLM` from `20` to `30` (proportional increase for game-level bets)

This sends the top 100 scored player prop candidates (instead of 40) and top 30 game-level candidates (instead of 20) to the LLM, giving it a much larger pool to select from when building slips.

### Consideration

Larger candidate lists mean a bigger LLM prompt, which increases token usage and latency slightly. 100 candidates is well within typical context window limits and should not cause issues.

