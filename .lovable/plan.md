
# Robust Refresh Script - Final Implementation

This plan incorporates all your feedback to create a production-ready refresh script.

---

## Summary of All Changes

| Issue | Current Code | Fix |
|-------|-------------|-----|
| Event types | `"started"` (line 571), `"broken"` (line 603) | Map to `"extended"` and `"broke"` |
| API failures | Silent `return []` on exception | Retry with backoff, raise on exhaustion |
| Threshold sanity | Hardcoded `< 100` / `< 30` | Fail on **0**, warn on low, add date freshness check |
| Batch inserts | One bad row kills entire batch | Chunked inserts + pre-validation + fail if any chunk fails |
| Timezone | `datetime.now().isoformat()` | Use `datetime.now(timezone.utc).isoformat()` |

---

## 1. Add Required Imports

**Lines 7-11:** Add new imports

```python
import os
import sys
from datetime import datetime, timezone
from typing import Optional
import time
from urllib.error import URLError
from http.client import HTTPException
```

---

## 2. Add Constants for Retry Logic

**After line 47 (MIN_STREAK_LENGTH):** Add retry constants

```python
MAX_RETRIES = 3
BASE_TIMEOUT = 60
ALLOWED_EVENT_TYPES = {"extended", "broke"}
```

---

## 3. Rewrite `fetch_player_game_logs()` with Retry Logic

**Lines 124-172:** Replace entire function

```python
def fetch_player_game_logs() -> list[dict]:
    """Fetch player game logs for the entire season with retry logic."""
    season_start = get_season_start_date()
    season = get_season_string()
    now = datetime.now()
    
    date_from = season_start.strftime("%m/%d/%Y")
    date_to = now.strftime("%m/%d/%Y")
    
    print(f"Fetching player game logs for {season} season ({date_from} to {date_to})...")
    
    last_error = None
    for attempt in range(MAX_RETRIES):
        try:
            # Exponential backoff: 2s, 6s, 14s
            wait_time = 2 ** (attempt + 1) + (attempt * 2)
            print(f"  Attempt {attempt + 1}/{MAX_RETRIES} (waiting {wait_time}s)...")
            time.sleep(wait_time)
            
            logs = PlayerGameLogs(
                season_nullable=season,
                date_from_nullable=date_from,
                date_to_nullable=date_to,
                timeout=BASE_TIMEOUT,
            )
            df = logs.get_data_frames()[0]
            
            if df.empty:
                raise ValueError("PlayerGameLogs returned empty dataframe")
            
            # Verify expected columns exist
            required_cols = ["PLAYER_ID", "PLAYER_NAME", "GAME_DATE", "GAME_ID"]
            missing = [c for c in required_cols if c not in df.columns]
            if missing:
                raise ValueError(f"Missing expected columns: {missing}")
            
            games = []
            for _, row in df.iterrows():
                game_date = datetime.strptime(row["GAME_DATE"], "%Y-%m-%dT%H:%M:%S").strftime("%Y-%m-%d")
                
                games.append({
                    "player_id": int(row["PLAYER_ID"]),
                    "player_name": row["PLAYER_NAME"],
                    "team_abbr": row["TEAM_ABBREVIATION"],
                    "game_id": str(row["GAME_ID"]),
                    "game_date": game_date,
                    "matchup": row.get("MATCHUP"),
                    "wl": row.get("WL"),
                    "pts": int(row["PTS"]) if row.get("PTS") is not None else None,
                    "reb": int(row["REB"]) if row.get("REB") is not None else None,
                    "ast": int(row["AST"]) if row.get("AST") is not None else None,
                    "fg3m": int(row["FG3M"]) if row.get("FG3M") is not None else None,
                    "blk": int(row["BLK"]) if row.get("BLK") is not None else None,
                    "stl": int(row["STL"]) if row.get("STL") is not None else None,
                    "sport": "NBA",
                })
            
            print(f"  Found {len(games)} player game records")
            return games  # Success!
            
        except (URLError, HTTPException, TimeoutError, ValueError) as e:
            last_error = e
            print(f"  Attempt {attempt + 1} failed: {type(e).__name__}: {e}")
        except Exception as e:
            # Catch unexpected errors but still retry
            last_error = e
            print(f"  Attempt {attempt + 1} failed (unexpected): {type(e).__name__}: {e}")
    
    # All retries exhausted
    raise RuntimeError(f"Failed to fetch player logs after {MAX_RETRIES} attempts: {last_error}")
```

---

## 4. Rewrite `fetch_team_game_logs()` with Same Pattern

**Lines 175-217:** Replace entire function with identical retry logic

```python
def fetch_team_game_logs() -> list[dict]:
    """Fetch team game logs for the entire season with retry logic."""
    season_start = get_season_start_date()
    season = get_season_string()
    now = datetime.now()
    
    date_from = season_start.strftime("%m/%d/%Y")
    date_to = now.strftime("%m/%d/%Y")
    
    print(f"Fetching team game logs for {season} season ({date_from} to {date_to})...")
    
    last_error = None
    for attempt in range(MAX_RETRIES):
        try:
            wait_time = 2 ** (attempt + 1) + (attempt * 2)
            print(f"  Attempt {attempt + 1}/{MAX_RETRIES} (waiting {wait_time}s)...")
            time.sleep(wait_time)
            
            logs = TeamGameLogs(
                season_nullable=season,
                date_from_nullable=date_from,
                date_to_nullable=date_to,
                timeout=BASE_TIMEOUT,
            )
            df = logs.get_data_frames()[0]
            
            if df.empty:
                raise ValueError("TeamGameLogs returned empty dataframe")
            
            required_cols = ["TEAM_ID", "TEAM_ABBREVIATION", "GAME_DATE", "GAME_ID"]
            missing = [c for c in required_cols if c not in df.columns]
            if missing:
                raise ValueError(f"Missing expected columns: {missing}")
            
            games = []
            for _, row in df.iterrows():
                game_date = datetime.strptime(row["GAME_DATE"], "%Y-%m-%dT%H:%M:%S").strftime("%Y-%m-%d")
                
                games.append({
                    "team_id": int(row["TEAM_ID"]),
                    "team_abbr": row["TEAM_ABBREVIATION"],
                    "game_id": str(row["GAME_ID"]),
                    "game_date": game_date,
                    "matchup": row.get("MATCHUP"),
                    "wl": row.get("WL"),
                    "pts": int(row["PTS"]) if row.get("PTS") is not None else None,
                    "sport": "NBA",
                })
            
            print(f"  Found {len(games)} team game records")
            return games
            
        except (URLError, HTTPException, TimeoutError, ValueError) as e:
            last_error = e
            print(f"  Attempt {attempt + 1} failed: {type(e).__name__}: {e}")
        except Exception as e:
            last_error = e
            print(f"  Attempt {attempt + 1} failed (unexpected): {type(e).__name__}: {e}")
    
    raise RuntimeError(f"Failed to fetch team logs after {MAX_RETRIES} attempts: {last_error}")
```

---

## 5. Fix Event Type Mappings

**Line 571:** Change `"started"` to `"extended"`

```python
"event_type": "extended",  # New streak (maps to "extended" per DB constraint)
```

**Line 603:** Change `"broken"` to `"broke"`

```python
"event_type": "broke",  # Streak ended
```

---

## 6. Add Validated Chunked Insert Function

**After line 612 (end of `detect_streak_events`):** Add new function

```python
def insert_streak_events(supabase: Client, events: list[dict]) -> None:
    """Insert streak events with validation and chunked batches. Fails run if any chunk fails."""
    if not events:
        print("No streak events to insert")
        return
    
    # Pre-validate event types
    valid_events = []
    invalid_events = []
    for event in events:
        event_type = event.get("event_type")
        if event_type in ALLOWED_EVENT_TYPES:
            event["created_at"] = datetime.now(timezone.utc).isoformat()
            valid_events.append(event)
        else:
            invalid_events.append(event)
            print(f"  WARNING: Invalid event_type '{event_type}' for {event.get('player_name')} - skipping")
    
    if invalid_events:
        print(f"  Filtered out {len(invalid_events)} events with invalid event_type")
    
    if not valid_events:
        print("No valid events to insert after filtering")
        return
    
    # Insert in chunks - fail the run if any chunk fails
    chunk_size = 200
    inserted = 0
    for i in range(0, len(valid_events), chunk_size):
        chunk = valid_events[i:i + chunk_size]
        chunk_num = i // chunk_size + 1
        total_chunks = (len(valid_events) + chunk_size - 1) // chunk_size
        
        try:
            supabase.table("streak_events").insert(chunk).execute()
            inserted += len(chunk)
            print(f"  Inserted chunk {chunk_num}/{total_chunks} ({len(chunk)} events)")
        except Exception as e:
            print(f"  ERROR inserting chunk {chunk_num}/{total_chunks}: {e}")
            print(f"  First event in failed chunk: {chunk[0]}")
            raise RuntimeError(f"Failed to insert streak events chunk {chunk_num}: {e}")
    
    print(f"Successfully inserted {inserted} streak events")
```

---

## 7. Add Freshness Check Helper

**After the new `insert_streak_events` function:** Add freshness validation

```python
def validate_data_freshness(games: list[dict], entity_type: str) -> bool:
    """Check if fetched data includes recent games. Returns True if fresh, False if stale."""
    if not games:
        return False
    
    # Find the most recent game date
    max_date = max(g["game_date"] for g in games)
    max_date_dt = datetime.strptime(max_date, "%Y-%m-%d")
    
    # Data should be from within last 2 days (accounting for off-days)
    today = datetime.now()
    days_old = (today - max_date_dt).days
    
    if days_old > 2:
        print(f"  WARNING: {entity_type} data is {days_old} days old (max date: {max_date})")
        return False
    
    print(f"  Data freshness OK: most recent {entity_type} game is {max_date}")
    return True
```

---

## 8. Update `upsert_data` Timestamps to UTC

**Line 624:** Change to UTC

```python
now = datetime.now(timezone.utc).isoformat()
```

---

## 9. Update `update_refresh_status` to UTC

**Line 646:** Change to UTC

```python
"last_run": datetime.now(timezone.utc).isoformat(),
```

---

## 10. Update `main()` with Fail-Fast Logic

**Lines 668-698:** Add sanity checks and use new insert function

```python
def main():
    """Main entry point."""
    start_time = datetime.now()
    print(f"=== NBA Data Refresh Started at {start_time.isoformat()} ===\n")
    print(f"Season: {get_season_string()}")
    print(f"Season start: {get_season_start_date().strftime('%Y-%m-%d')}\n")
    
    supabase = get_supabase_client()
    
    # 1. Fetch and upsert today's games
    games = fetch_todays_games()
    if games:
        upsert_data(supabase, "games_today", games)
    update_refresh_status(supabase, 2)  # id=2 for games
    
    print()
    
    # 2. Fetch player game logs (will raise on failure after retries)
    player_games = fetch_player_game_logs()
    
    # Fail-fast: empty results = hard fail
    if len(player_games) == 0:
        print("ERROR: Player game fetch returned 0 records - aborting to prevent data loss")
        sys.exit(1)
    
    # Warning for suspiciously low counts
    if len(player_games) < 100:
        print(f"WARNING: Only {len(player_games)} player games - unusually low")
    
    # Freshness check (warning only, doesn't abort)
    validate_data_freshness(player_games, "player")
    
    upsert_data(supabase, "player_recent_games", player_games, ["player_id", "game_id"])
    
    print()
    
    # 3. Fetch team game logs (will raise on failure after retries)
    team_games = fetch_team_game_logs()
    
    if len(team_games) == 0:
        print("ERROR: Team game fetch returned 0 records - aborting to prevent data loss")
        sys.exit(1)
    
    if len(team_games) < 30:
        print(f"WARNING: Only {len(team_games)} team games - unusually low")
    
    validate_data_freshness(team_games, "team")
    
    upsert_data(supabase, "team_recent_games", team_games, ["team_id", "game_id"])
    
    print()
    
    # 4. Calculate player streaks
    player_streaks = calculate_streaks(player_games)
    
    # 5. Calculate team streaks
    team_streaks = calculate_team_streaks(team_games)
    
    # 6. Combine all streaks
    all_streaks = player_streaks + team_streaks
    
    # 7. Detect streak events
    events = detect_streak_events(supabase, all_streaks)
    
    # 8. Insert events using validated chunked insert (will raise on failure)
    insert_streak_events(supabase, events)
    
    # 9. Replace streaks table (delete old, insert new)
    print("Replacing streaks table...")
    supabase.table("streaks").delete().eq("sport", "NBA").execute()
    if all_streaks:
        upsert_data(supabase, "streaks", all_streaks)
    
    # 10. Update refresh status
    update_refresh_status(supabase, 1)  # id=1 for players/streaks
    
    end_time = datetime.now()
    duration = (end_time - start_time).total_seconds()
    
    print(f"\n=== Refresh Complete in {duration:.1f}s ===")
    print(f"Games today: {len(games)}")
    print(f"Player game records: {len(player_games)}")
    print(f"Team game records: {len(team_games)}")
    print(f"Player streaks: {len(player_streaks)}")
    print(f"Team streaks: {len(team_streaks)}")
    print(f"Streak events: {len(events)}")
```

---

## Files Changed

| File | Action |
|------|--------|
| `scripts/refresh.py` | Major update with all fixes above |

---

## Expected Behavior After Implementation

| Scenario | Before | After |
|----------|--------|-------|
| NBA API timeout | Silent `[]`, continues with bad data | Retries 3x, then fails the job |
| Empty dataframe | Continues silently | Raises `ValueError`, retries, then fails |
| `event_type="started"` | DB constraint violation | Mapped to `"extended"`, inserts OK |
| `event_type="broken"` | DB constraint violation | Mapped to `"broke"`, inserts OK |
| One bad event in batch | Entire batch fails | Pre-validated, chunk fails = job fails |
| Stale data (old dates) | No warning | Warning logged but continues |
| Zero records fetched | Overwrites good data | `sys.exit(1)`, job goes red |

---

## Next Steps After Approval

1. Implement the changes to `scripts/refresh.py`
2. Run the GitHub Actions workflow manually
3. Check logs to verify:
   - Retry attempts are logged
   - Data counts are reasonable
   - Freshness check passes
   - Events insert successfully
