

## Plan: Fix Provider-Agnostic Odds System

### Problem Summary
The current `get-odds` implementation has a broken backup adapter (wrong endpoint, wrong response shape), potentially malformed URLs, overly generous TTLs, and no cache cleanup.

### Changes

#### 1. Fix `supabase/functions/get-odds/index.ts` — Complete rewrite of Odds-API.io adapter + TTL fix + cache cleanup

**A. Verify The Odds API URLs (lines 47, 50)**
The URLs in the source file appear correct (`&regions=us`). The `®ions=us` the user saw was likely a rendering artifact. Will verify and ensure all query strings use proper `&` encoding.

**B. Rewrite `getOddsFromOddsApiIo` (lines 94-158)**
The current adapter is entirely wrong:
- Uses nonexistent `/v1/odds?sport=...&market=...` endpoint
- Assumes a response shape that doesn't match the real API

Per the Odds-API.io OpenAPI spec:
- **Step 1**: `GET /v3/events?apiKey=KEY&sport=basketball&league=usa-nba&status=pending` — returns an array of `SimpleEventDto` objects with `id`, `home`, `away`, `date`
- **Step 2**: For each event (or specific eventId), `GET /v3/odds?apiKey=KEY&eventId=ID&bookmakers=DraftKings,FanDuel` — returns a single `EventResponse`

The `EventResponse` shape is:
```text
{
  id: number,
  home: string,
  away: string,
  date: string,
  bookmakers: {
    "DraftKings": [
      { name: "ML", odds: [{ home: "1.5", away: "2.3" }], updatedAt: "..." },
      { name: "Totals", odds: [{ over: "1.9", under: "1.9", hdp: 220.5 }], updatedAt: "..." },
      { name: "Player Props", odds: [{ over: "-110", under: "-110", hdp: 24.5, label: "LeBron James" }] }
    ]
  }
}
```

Key differences from The Odds API:
- `bookmakers` is an **object** (keyed by name), not an array
- Market names are display names ("ML", "Spread", "Totals", "Player Props"), not slugs
- Odds fields are `home`/`away`/`over`/`under`/`hdp`/`label`, not `outcomes[]`
- Bookmaker names use display format ("DraftKings" not "draftkings")

The new adapter will:
1. Map internal market keys to Odds-API.io equivalents
2. If no `eventId` is provided, first fetch events from `/v3/events`
3. Fetch odds via `/v3/odds` for each event
4. Normalize the response into the shared `NormalizedOdds` format

**C. Tighten TTL defaults (line 257)**
- Change game-list default from 300s to 90s
- Change player props default from 120s to 45s

**D. Add cache cleanup** — After successful cache upsert, delete expired rows:
```sql
DELETE FROM odds_cache WHERE expires_at < now() - interval '1 hour'
```
This runs as a fire-and-forget cleanup after each fresh fetch, keeping the table lean.

#### 2. Update `src/hooks/useOdds.ts` — Match tightened TTLs
- Change default `staleTime` and `refetchInterval` from 300s to 90s (lines 37-38)

#### 3. Update `src/types/odds.ts` — No changes needed
The normalized types are correct as-is.

#### 4. No changes to `collect-line-snapshots` or `ai-bet-builder`
These already call `get-odds` internally and will automatically benefit from the fixed adapter and tighter TTLs.

#### 5. Confirm no direct frontend provider calls
Search confirmed: zero matches for `the-odds-api.com` or `odds-api.io` in `src/`. All frontend odds access goes through `supabase.functions.invoke("get-odds")`.

### Files Changed

| File | Lines Changed | What |
|------|--------------|------|
| `supabase/functions/get-odds/index.ts` | 94-158 (adapter rewrite), 257 (TTL), new cleanup function | Fix backup adapter, tighten TTLs, add cache cleanup |
| `src/hooks/useOdds.ts` | 37-38 | Match tightened TTL defaults |

### After Deployment
- Deploy `get-odds` edge function
- Test with `curl` against the edge function to verify both adapters return data
- Test failover by temporarily removing `ODDS_API_KEY` and confirming backup kicks in

