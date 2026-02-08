
# Fix Team Streak Duplicate Key Bug

## Problem

The `scripts/refresh.py` file has a bug where all team streaks use `"player_id": 0`, which causes database upsert conflicts. When multiple teams have active streaks, they all try to use the same key, leading to only one team's data being saved.

## Solution

Change `"player_id": 0` to `"player_id": tid` (the team ID) in three places within the `calculate_team_streaks()` function. This gives each team a unique identifier.

---

## Changes Required

### 1. Fix `scripts/refresh.py` (3 locations)

**Line 431 - ML (Moneyline) streak block:**
```python
# Before
"player_id": 0,  # Not applicable for teams

# After
"player_id": tid,  # Use team_id for unique identification
```

**Line 489 - PTS (Team Points Over) streak block:**
```python
# Before
"player_id": 0,

# After
"player_id": tid,
```

**Line 547 - PTS_U (Team Points Under) streak block:**
```python
# Before
"player_id": 0,

# After
"player_id": tid,
```

---

### 2. Update `.gitignore`

Add Python virtual environment and cache files to prevent accidental commits:

```gitignore
# Python
.venv/
__pycache__/
*.pyc
```

---

## Summary of File Changes

| File | Change |
|------|--------|
| `scripts/refresh.py` | Replace `"player_id": 0` with `"player_id": tid` on lines 431, 489, and 547 |
| `.gitignore` | Add `.venv/`, `__pycache__/`, and `*.pyc` entries |

---

## Technical Details

- The `tid` variable is the team's NBA API ID (e.g., `1610612744` for Golden State Warriors)
- This variable is already available in the loop: `for tid, data in team_data.items():`
- Using `tid` ensures each team's streaks are stored with a unique composite key
- The database uses `(player_id, stat, threshold, entity_type)` for upserts, so unique `player_id` values prevent overwrites
