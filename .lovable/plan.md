

## Plan: Provider-Agnostic Odds System for BetStreaks

### What This Does
Introduces a multi-provider odds architecture with caching, automatic failover, and a single backend endpoint for the frontend. The Odds API remains primary; Odds-API.io becomes the backup. A new `odds_cache` table stores normalized odds so repeated requests don't hit external APIs.

### Current State
- **No frontend code calls odds providers directly** — all odds fetching happens in two edge functions: `collect-line-snapshots` and `ai-bet-builder`
- Both hardcode `api.the-odds-api.com/v4` URLs and the `ODDS_API_KEY` secret
- No caching layer exists; every edge function invocation hits the Odds API

### Architecture

```text
Frontend (hooks)
  │
  ▼
get-odds Edge Function
  │
  ├─ Check odds_cache table (fresh? → return immediately)
  │
  ├─ Stale/missing → Primary adapter (The Odds API)
  │     │ fail?
  │     ▼
  │   Backup adapter (Odds-API.io)
  │     │ fail?
  │     ▼
  │   Return stale cache + is_stale flag
  │
  └─ Write fresh results → odds_cache
```

### Changes

#### 1. Database Migration — `odds_cache` table
Create table with columns: `id`, `sport_key`, `event_id`, `market_key`, `bookmaker_key`, `home_team`, `away_team`, `commence_time`, `odds_data` (jsonb), `provider`, `fetched_at`, `expires_at`, `created_at`, `updated_at`. Add indexes on `(sport_key, event_id, market_key, bookmaker_key)` and `expires_at`. Public SELECT RLS policy; service_role INSERT/UPDATE.

#### 2. New Secret
- `ODDS_API_IO_KEY` — API key for the backup provider (Odds-API.io)

#### 3. New Edge Function: `get-odds`
Single entry point for the frontend. Accepts `{ sport, eventId?, market, bookmaker?, ttl? }`.

Contains:
- **Normalized types** (`NormalizedOdds`, `NormalizedOutcome`) — shared shape both adapters produce
- **Primary adapter** — fetches from `api.the-odds-api.com/v4`, maps response to normalized format
- **Backup adapter** — fetches from `api.odds-api.io`, maps response to same normalized format
- **Cache logic** — check `odds_cache` first; if `expires_at > now()` return cached; otherwise fetch, upsert cache, return fresh
- **Fallback chain** — primary → backup → stale cache → error
- **Response metadata** — `provider`, `fetched_at`, `is_stale`, `fallback_used`

Default TTLs: 5 minutes for game-list odds, 2 minutes for player props (configurable via `ttl` param).

#### 4. Refactor `collect-line-snapshots`
- Replace direct Odds API calls with internal calls to `get-odds` edge function (or import shared adapter code)
- This ensures the pipeline also benefits from caching and failover
- Falls back gracefully when both providers are down

#### 5. Refactor `ai-bet-builder`
- Replace the ~60 lines of direct Odds API fetching (lines 634-741) with calls to the `get-odds` edge function
- Remove `ODDS_API_BASE` constant and direct `fetch()` calls to the-odds-api.com
- Parse the normalized response format instead of raw Odds API format

#### 6. Frontend Hook: `useOdds`
Create `src/hooks/useOdds.ts` — a React Query hook that calls `get-odds` via `supabase.functions.invoke()`. Returns normalized odds with `isStale`, `fallbackUsed`, `provider` metadata. Used by any component that needs odds data.

#### 7. Update `supabase/config.toml`
Add `[functions.get-odds]` with `verify_jwt = false`.

### Files Created/Modified
| File | Action |
|------|--------|
| `supabase/migrations/xxx_create_odds_cache.sql` | New — table + indexes + RLS |
| `supabase/functions/get-odds/index.ts` | New — cache + adapters + failover |
| `supabase/functions/collect-line-snapshots/index.ts` | Modified — use get-odds internally |
| `supabase/functions/ai-bet-builder/index.ts` | Modified — use get-odds internally |
| `src/hooks/useOdds.ts` | New — frontend hook |
| `src/types/odds.ts` | New — shared normalized types |
| `supabase/config.toml` | Modified — add get-odds entry |

### Env Vars Needed
- `ODDS_API_KEY` — already exists
- `ODDS_API_IO_KEY` — **new**, user must provide
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — already exist

### Extensibility
Adding a new provider = writing one new adapter function that returns `NormalizedOdds[]`. No other code changes needed.

