
# Enhanced Data Refresh & Cleanup Plan

This plan covers all four requested changes with the full-season data window you asked for.

---

## Summary of Changes

| Task | Description | Impact |
|------|-------------|--------|
| Fetch full season data | Use season start date instead of days_back | Streaks show complete season history |
| Add thresholds | REB 15/18/20, PTS 45/50 | Catch elite performances |
| Add team streaks | ML wins, PTS over/under | Teams tab populated |
| Clean up Edge Functions | Remove 2 obsolete functions | Cleaner codebase |

---

## 1. Fetch Data for the Entire Season

Instead of using `days_back=45` (or even 120 days), the script will calculate the **season start date** dynamically:

- **2024-25 NBA Season** started **October 22, 2024**
- Script will fetch all games from season start through today
- This ensures all player/team history is captured for accurate streak detection

The updated logic:
- If current month is October or later: season started Oct 22 of current year
- If current month is before October: season started Oct 22 of previous year
- Fetch all game logs from that date forward (no arbitrary day limit)

---

## 2. Add Higher Thresholds for Elite Performers

**Current Thresholds**:
- PTS: 10, 15, 20, 25, 30, 35, 40
- REB: 5, 8, 10, 12, 15

**New Thresholds**:
- PTS: Add **45, 50** (for superstar games like Luka, Giannis)
- REB: Add **18, 20** (for elite rebounders like Gobert, Wembanyama)

---

## 3. Add Team Streak Support

The Teams tab will now display fresh streaks for:

| Stat | Description | Thresholds |
|------|-------------|------------|
| ML | Moneyline (consecutive wins) | Win detection only |
| PTS | Team Points Over | 100, 105, 110, 115, 120, 125, 130 |
| PTS_U | Team Points Under | 100, 105, 110, 115, 120, 125 |

Implementation:
- Add `TeamGameLogs` from nba_api
- Create `fetch_team_game_logs()` function
- Create `calculate_team_streaks()` function
- Store with `entity_type="team"` and `player_id=0`

---

## 4. Clean Up Obsolete Edge Functions

**Functions to Delete**:
- `supabase/functions/refresh-games-today/` - Now handled by Python script
- `supabase/functions/refresh-players-and-streaks/` - Now handled by Python script

**Config Cleanup**:
- Remove entries from `supabase/config.toml`

**Functions to Keep**:
- `admin-trigger-refresh/` - Manual admin trigger
- `create-checkout-session/` - Stripe payments
- `create-portal-session/` - Stripe portal
- `stripe-webhook/` - Stripe webhooks
- `healthcheck/` - Health monitoring

---

## Technical Details

### File Changes

| File | Action |
|------|--------|
| `scripts/refresh.py` | Major update: full season fetch, new thresholds, team streaks |
| `supabase/functions/refresh-games-today/` | DELETE entire directory |
| `supabase/functions/refresh-players-and-streaks/` | DELETE entire directory |
| `supabase/config.toml` | Remove 2 function entries |

### Updated refresh.py Logic

**Season Date Calculation**:
```python
def get_season_start_date():
    """Get the start date of the current NBA season."""
    now = datetime.now()
    if now.month >= 10:
        # Season started this year (Oct 22)
        return datetime(now.year, 10, 22)
    else:
        # Season started last year (Oct 22)
        return datetime(now.year - 1, 10, 22)
```

**Updated Thresholds**:
```python
STAT_THRESHOLDS = {
    "PTS": [10, 15, 20, 25, 30, 35, 40, 45, 50],
    "REB": [5, 8, 10, 12, 15, 18, 20],
    "AST": [3, 5, 8, 10, 12],
    "3PM": [1, 2, 3, 4, 5, 6],
    "BLK": [1, 2, 3, 4, 5],
    "STL": [1, 2, 3, 4],
}

TEAM_STAT_THRESHOLDS = {
    "ML": [1],
    "PTS": [100, 105, 110, 115, 120, 125, 130],
    "PTS_U": [100, 105, 110, 115, 120, 125],
}
```

### New Team Functions

1. **`fetch_team_game_logs()`**: Fetches team game data for the full season
2. **`calculate_team_streaks()`**: Calculates ML/PTS/PTS_U streaks
3. **`detect_streak_events()`**: Updated to handle both player and team entity types

### Expected Results After Implementation

- Player streaks: Now showing 10+ game runs (full season data)
- REB 15+, 18+, 20+ streaks visible for elite rebounders
- PTS 45+, 50+ streaks visible for superstar scorers
- Teams tab: Populated with ML wins, PTS over/under streaks
- Cleaner codebase: 2 fewer Edge Functions to maintain
