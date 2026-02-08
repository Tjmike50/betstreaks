
# Enhanced Data Refresh & Cleanup Plan

✅ **IMPLEMENTED**

---

## Summary of Changes

| Task | Description | Status |
|------|-------------|--------|
| Fetch full season data | Use season start date (Oct 22) instead of days_back | ✅ Done |
| Add thresholds | REB 18/20, PTS 45/50 | ✅ Done |
| Add team streaks | ML wins, PTS over/under | ✅ Done |
| Clean up Edge Functions | Remove 2 obsolete functions | ✅ Done |

---

## Implementation Details

### 1. Full Season Data Fetch

The script now calculates the season start date dynamically:
- **2024-25 NBA Season** started **October 22, 2024**
- All games from season start through today are fetched
- No arbitrary day limits

```python
def get_season_start_date() -> datetime:
    now = datetime.now()
    if now.month >= 10:
        return datetime(now.year, 10, 22)
    else:
        return datetime(now.year - 1, 10, 22)
```

### 2. Updated Thresholds

```python
STAT_THRESHOLDS = {
    "PTS": [10, 15, 20, 25, 30, 35, 40, 45, 50],  # Added 45, 50
    "REB": [5, 8, 10, 12, 15, 18, 20],             # Added 18, 20
    "AST": [3, 5, 8, 10, 12],
    "3PM": [1, 2, 3, 4, 5, 6],
    "BLK": [1, 2, 3, 4, 5],
    "STL": [1, 2, 3, 4],
}

TEAM_STAT_THRESHOLDS = {
    "ML": [1],                                      # Moneyline wins
    "PTS": [100, 105, 110, 115, 120, 125, 130],    # Team points over
    "PTS_U": [100, 105, 110, 115, 120, 125],       # Team points under
}
```

### 3. Team Streak Support

New functions added:
- `fetch_team_game_logs()` - Fetches team game data for full season
- `calculate_team_streaks()` - Calculates ML/PTS/PTS_U streaks
- `detect_streak_events()` - Updated to handle both player and team entities

Team streaks stored with:
- `entity_type="team"`
- `player_id=0`
- `player_name` = team full name (e.g., "Los Angeles Lakers")

### 4. Cleaned Up Edge Functions

**Deleted:**
- `supabase/functions/refresh-games-today/`
- `supabase/functions/refresh-players-and-streaks/`

**Updated:**
- `supabase/config.toml` - Removed deleted function entries
- `admin-trigger-refresh` - Now informs admins to use GitHub Actions

---

## Next Steps

To populate the data, run the GitHub Actions workflow:
1. Go to GitHub → Actions tab
2. Select "NBA Data Refresh" workflow
3. Click "Run workflow"

Or wait for the scheduled run.
