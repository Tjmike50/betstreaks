
## Update Primary Odds API Key

Replace the existing `ODDS_API_KEY` secret in Supabase with the new value so all edge functions immediately start using it.

### What will happen
1. The `ODDS_API_KEY` runtime secret is updated to `d6e56fe188e5f94382bf6467300e75a0`.
2. All edge functions that read `Deno.env.get("ODDS_API_KEY")` automatically pick up the new value on their next invocation — no code changes, no redeploy.
3. The backup `ODDS_API_IO_KEY` is left untouched and continues to serve as fallback.

### Affected edge functions (no code changes)
- `get-odds` (primary provider call)
- `collect-line-snapshots`
- `refresh-mlb-data`
- `refresh-wnba-data`
- Any other function using `ODDS_API_KEY`

### Verification after update
- Call `get-odds` with a basic NBA `h2h` request and confirm the response `meta.provider` is `the-odds-api` and `fallbackUsed: false`.
- Check edge function logs for any 401 / 403 errors from `api.the-odds-api.com`.

### Notes
- No database migration required.
- No frontend changes required.
- If the new key has different quota/tier, rate-limit behavior may change — we'll watch for 429s in the first run.
