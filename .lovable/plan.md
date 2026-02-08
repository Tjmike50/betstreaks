
# NBA API Integration Plan

## Overview
This plan implements real NBA data fetching in the edge functions, adds a healthcheck endpoint, and provides details on the current database state.

---

## Current Database State

### games_today (13 rows shown)
| game_date | away_team | home_team | status | scores |
|-----------|-----------|-----------|--------|--------|
| 2026-02-02 | PHI | LAC | 10:00 pm ET | 0-0 |
| 2026-02-02 | NOP | CHA | 2nd Qtr | 0-0 |
| 2026-02-02 | HOU | IND | 7:00 pm ET | 0-0 |
| 2026-01-30 | DET | GSW | 10:00 pm ET | 0-0 |
| ... 9 more games from Jan 30 | | | | |

**Last refresh**: 2026-02-08 08:23:00 (cron working, but no API logic yet)

### streaks (sample)
| player_name | stat | threshold | streak_len | season_win_pct |
|-------------|------|-----------|------------|----------------|
| Julius Randle | PTS | 5+ | 50 | 100% |
| Julius Randle | PTS | 6+ | 50 | 100% |
| Julius Randle | REB | 2+ | 50 | 100% |

**Last refresh**: 2026-02-08 08:25:44 (cron working, but no API logic yet)

### player_recent_games (sample)
| game_date | player_name | team | pts | reb | ast | fg3m | blk | stl |
|-----------|-------------|------|-----|-----|-----|------|-----|-----|
| 2026-02-01 | Shai Gilgeous-Alexander | OKC | 34 | 5 | 13 | 1 | 1 | 2 |
| 2026-02-01 | DeMar DeRozan | SAC | 32 | 2 | 5 | 1 | 0 | 0 |
| 2026-02-01 | LeBron James | LAL | 22 | 5 | 6 | 2 | 0 | 1 |

---

## Implementation Tasks

### Task 1: Create Healthcheck Edge Function
**Purpose**: Allow testing cron connectivity without authentication

**File**: `supabase/functions/healthcheck/index.ts`

**Implementation**:
- Simple endpoint returning `{ ok: true, timestamp: ... }`
- No authentication required
- Useful for debugging cron-job.org connectivity issues

**Config update**: Add `[functions.healthcheck]` with `verify_jwt = false`

---

### Task 2: Implement refresh-games-today with NBA CDN API
**Purpose**: Fetch today's NBA games with live scores

**API Endpoint**: `https://cdn.nba.com/static/json/liveData/scoreboard/todaysScoreboard_00.json`
- No authentication required
- Returns current day's games with live scores
- Works from edge functions (CDN endpoint, not stats.nba.com)

**Implementation Details**:

1. **Fetch today's scoreboard** from NBA CDN
2. **Parse game data**:
   - `gameId` -> `id`
   - `homeTeam.teamTricode` -> `home_team_abbr`
   - `awayTeam.teamTricode` -> `away_team_abbr`
   - `homeTeam.score` -> `home_score`
   - `awayTeam.score` -> `away_score`
   - `gameStatusText` -> `status`
   - `gameTimeUTC` -> derive `game_date` and `game_time`
3. **Upsert** into `games_today` table
4. **Update** `refresh_status` id=2

**Data flow**:
```text
NBA CDN API
    |
    v
Parse JSON response
    |
    v
Transform to GameData[]
    |
    v
Upsert to games_today
    |
    v
Update refresh_status
```

---

### Task 3: Implement refresh-players-and-streaks with NBA Stats API
**Purpose**: Fetch player game logs and calculate streaks

**Challenge**: stats.nba.com blocks cloud IP addresses and requires specific headers

**Recommended Approach**: Use the `leaguegamelog` endpoint which returns all player game logs for the season in one call (more efficient than per-player calls)

**API Endpoint**: `https://stats.nba.com/stats/leaguegamelog`
**Required Headers**:
```text
Host: stats.nba.com
User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64)...
Accept: application/json, text/plain, */*
x-nba-stats-origin: stats
x-nba-stats-token: true
Referer: https://stats.nba.com/
Connection: keep-alive
```

**Implementation Steps**:

1. **Fetch league game log** for current season
   - Parameters: `Season=2025-26`, `PlayerOrTeam=P`, `SeasonType=Regular Season`
   - Get last ~20 days of games

2. **Parse player stats** from response:
   - `PLAYER_ID`, `PLAYER_NAME`, `TEAM_ABBREVIATION`
   - `GAME_ID`, `GAME_DATE`, `MATCHUP`, `WL`
   - `PTS`, `REB`, `AST`, `FG3M`, `BLK`, `STL`

3. **Upsert to player_recent_games** table

4. **Calculate streaks** for each player+stat combination:
   - Supported stats: PTS, REB, AST, 3PM, BLK, STL
   - Threshold ranges per stat type (from `THRESHOLD_RANGES`)
   - Check consecutive games where stat >= threshold
   - Calculate season_wins, season_games, season_win_pct
   - Calculate last5, last10, last15, last20 metrics

5. **Detect streak events** by comparing old vs new:
   - "started" - new streak >= 3 that didn't exist
   - "extended" - streak length increased
   - "broken" - streak that existed is now gone

6. **Upsert streaks** and **insert streak_events**

7. **Update refresh_status** id=1

**Streak Calculation Logic**:
```text
For each player:
  For each stat (PTS, REB, AST, 3PM, BLK, STL):
    For each threshold in range:
      Sort games by date DESC
      Count consecutive hits from most recent
      If streak >= minimum (e.g., 3):
        Calculate all metrics
        Add to streaks list
```

**Fallback Option**: If stats.nba.com blocks requests, consider:
- Using balldontlie.io API (requires API key secret)
- Using a proxy service
- Pre-populating data from a local script and only doing incremental updates

---

### Task 4: Update supabase/config.toml
Add healthcheck function configuration.

---

## Technical Considerations

### NBA API Headers
The stats.nba.com API is known to block cloud server IPs. The edge function may need:
- Proper browser-like headers
- Potential fallback to alternative data sources

### Rate Limiting
- Implement delays between requests if needed
- Use batch endpoints (leaguegamelog) vs per-player endpoints

### Error Handling
- Log detailed errors for debugging
- Return partial success if some operations fail
- Non-fatal errors for refresh_status updates

### Timezone Handling
- NBA API uses Eastern Time for game dates
- Store dates in ISO format
- Parse game times preserving ET designation

---

## Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `supabase/functions/healthcheck/index.ts` | Create | Simple healthcheck endpoint |
| `supabase/functions/refresh-games-today/index.ts` | Modify | Add NBA CDN API integration |
| `supabase/functions/refresh-players-and-streaks/index.ts` | Modify | Add stats.nba.com integration |
| `supabase/config.toml` | Modify | Add healthcheck function config |

---

## Testing Plan

After implementation:
1. Deploy edge functions
2. Test healthcheck endpoint (no auth)
3. Test refresh-games-today via admin button or curl
4. Check games_today table for updated data
5. Test refresh-players-and-streaks
6. Check streaks and player_recent_games tables
7. Verify refresh_status timestamps updated

---

## Risk Assessment

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| stats.nba.com IP blocking | High | Use CDN endpoints where possible; implement fallback |
| API rate limiting | Medium | Add delays; use efficient batch endpoints |
| Data format changes | Low | Add validation; log unexpected formats |
| Edge function timeout | Medium | Optimize queries; paginate large datasets |
