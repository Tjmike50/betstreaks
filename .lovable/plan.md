
User has a new Odds API key value (rotated). Need to update the `ODDS_API_KEY` runtime secret with the new value, then verify the failover chain works end-to-end.

## Plan: Update Odds API Key & Verify

### Step 1: Update the secret
Replace the value of `ODDS_API_KEY` (already exists in the project) with your new key. I'll trigger the secret update prompt — paste the new key value when asked.

### Step 2: Verify end-to-end
Once the new key is saved, I will:
1. Call `get-odds` for `basketball_nba` / `h2h` → expect `provider: "the-odds-api"`, `fromCache: false`, non-empty `data`
2. Call `get-odds` for `player_points` → confirm props work
3. Call again immediately → confirm `fromCache: true` (cache hit)
4. Read `odds_cache` table to confirm rows are landing
5. Check `get-odds` edge function logs for any warnings

### Step 3: Report
Show actual response payloads (provider, count, sample outcome) so you see real data — not just metadata.

No code changes. Pure secret rotation + verification.
