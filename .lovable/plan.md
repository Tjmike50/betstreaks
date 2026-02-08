
# GitHub Actions Data Refresh Plan

## Overview
Replace the unreliable cron-job.org + Edge Functions approach with a GitHub Actions workflow that runs your existing Python script on a schedule. This is the most stable path since:
- You already have working Python code locally
- GitHub Actions is free and has great logging
- No need to fight IP blocking or Deno/TypeScript rewrites

---

## Files to Create

### 1. Python Refresh Script
**File**: `scripts/refresh.py`

This script will:
- Use `nba_api` to fetch player game logs and today's scoreboard
- Connect to Supabase using the Python client
- Upsert data into:
  - `games_today` (schedule + live scores)
  - `player_recent_games` (player stats per game)
  - `streaks` (calculated streaks)
  - `streak_events` (started/extended/broken events)
  - `refresh_status` (timestamp tracking)

### 2. Requirements File
**File**: `requirements.txt`

```
nba_api>=1.4.1
supabase>=2.0.0
python-dotenv>=1.0.0
```

### 3. GitHub Actions Workflow
**File**: `.github/workflows/refresh.yml`

```yaml
name: Refresh NBA Data

on:
  schedule:
    - cron: "0 */3 * * *"   # Every 3 hours (UTC)
  workflow_dispatch: {}      # Manual trigger button

jobs:
  refresh:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.11"
          cache: "pip"
      - run: pip install -r requirements.txt
      - name: Run refresh
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
        run: python scripts/refresh.py
```

---

## Database Target Tables

| Table | Primary Key | What It Stores |
|-------|-------------|----------------|
| `games_today` | `id` (game_id) | Today's NBA schedule + scores |
| `player_recent_games` | `(player_id, game_id)` | Individual player stats per game |
| `streaks` | `id` (uuid) | Active streaks (player + stat + threshold) |
| `streak_events` | `id` (uuid) | History of streak changes |
| `refresh_status` | `id` (1=players, 2=games) | Last refresh timestamps |

---

## Python Script Logic

```text
1. Fetch today's scoreboard from nba_api
   └── Upsert into games_today

2. Fetch league game log (last 30 days)
   └── Upsert into player_recent_games

3. For each player:
   For each stat (PTS, REB, AST, 3PM, BLK, STL):
     For each threshold:
       └── Count consecutive hits from most recent game
       └── Calculate season_wins, last5, last10, etc.
       └── If streak >= 3, add to streaks list

4. Compare old streaks vs new streaks
   └── Detect started/extended/broken events
   └── Insert into streak_events

5. Upsert streaks table

6. Update refresh_status timestamps
```

---

## Setup Steps (For You)

### Step 1: Add GitHub Secrets
Go to your repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**

Add these two secrets:
- `SUPABASE_URL` = `https://enhksxikgvvdohseivpx.supabase.co`
- `SUPABASE_SERVICE_ROLE_KEY` = (get from Supabase Dashboard → Settings → API)

### Step 2: Merge the Code
After I create the files, push to main branch.

### Step 3: Test Manually
Go to **Actions** tab → **Refresh NBA Data** → **Run workflow** → Check logs.

### Step 4: Verify Data
Check the `player_recent_games` and `streaks` tables in Supabase to confirm Scottie Barnes shows up.

---

## What Happens to Edge Functions?

Keep them as-is for now. They're harmless and you might want them later for real-time score updates during games. The Python script handles the heavy lifting (player stats + streaks), while edge functions can optionally handle live game score polling if you ever want that.

---

## Timeline

| Step | Effort |
|------|--------|
| Create Python script | 5 min |
| Create requirements.txt | 1 min |
| Create GitHub workflow | 1 min |
| You add secrets in GitHub | 2 min |
| Test run | 2 min |

**Total: ~10 minutes to working automated refreshes**
