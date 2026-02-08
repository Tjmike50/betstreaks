
# Updated Plan: Free Scheduling Alternatives

## Current Status ✅
The core infrastructure is already implemented:
- **Edge Functions**: `refresh-games-today`, `refresh-players-and-streaks`, and `admin-trigger-refresh` are deployed
- **Admin Button**: Only visible to users with `is_admin=true` in `user_flags`
- **Secret**: `REFRESH_SECRET` is configured

## The Problem
Supabase's `pg_cron` extension requires the **Pro plan** ($25/month). We need a free alternative for scheduled refresh.

## Free Scheduling Options

### Option A: External Free Cron Service (Recommended)
Use a free service like **cron-job.org** or **EasyCron** to call your Edge Functions:

| Service | Free Tier | Interval |
|---------|-----------|----------|
| cron-job.org | Unlimited jobs | 1 min minimum |
| EasyCron | 200 calls/month | 20 min minimum |
| Cronitor | 5 monitors | 1 min minimum |

**Setup Steps:**
1. Create account on cron-job.org (free, no credit card)
2. Create two cron jobs:
   - **Games refresh** (every 10 min): `POST` to `https://[project-ref].supabase.co/functions/v1/refresh-games-today`
   - **Players refresh** (every 3 hours): `POST` to `https://[project-ref].supabase.co/functions/v1/refresh-players-and-streaks`
3. Add header: `x-refresh-secret: [your-secret-value]`

### Option B: GitHub Actions (Free for Public Repos)
Create a scheduled workflow that runs periodically:

```yaml
# .github/workflows/refresh-data.yml
name: Refresh Data
on:
  schedule:
    - cron: '*/10 * * * *'  # Every 10 minutes (games)
    - cron: '0 */3 * * *'   # Every 3 hours (players)
  workflow_dispatch:  # Manual trigger

jobs:
  refresh:
    runs-on: ubuntu-latest
    steps:
      - name: Refresh Games
        run: |
          curl -X POST https://[project].supabase.co/functions/v1/refresh-games-today \
            -H "x-refresh-secret: ${{ secrets.REFRESH_SECRET }}"
```

**Note**: GitHub Actions has a 5-minute minimum interval and may have delays during high load.

### Option C: Manual-Only (Simplest)
Keep only the admin button and run refreshes manually. This works if you:
- Don't need real-time updates
- Are comfortable triggering refreshes yourself

## My Recommendation

**Use Option A (cron-job.org)** because:
- Completely free with no limits
- More reliable than GitHub Actions for frequent schedules
- Easy to set up in 5 minutes
- Your Edge Functions are already secured with `x-refresh-secret`

## What's Already Done
No code changes needed! Everything is implemented:

| Component | Status |
|-----------|--------|
| `refresh-games-today` Edge Function | ✅ Deployed |
| `refresh-players-and-streaks` Edge Function | ✅ Deployed |
| `admin-trigger-refresh` Edge Function | ✅ Deployed |
| `AdminRefreshButton` component | ✅ Working |
| `useAdmin` hook | ✅ Working |
| `REFRESH_SECRET` environment variable | ✅ Configured |
| Empty state with refresh info | ✅ Implemented |

## Next Step: Set Up cron-job.org

1. Go to https://cron-job.org and create a free account
2. Click "Create cronjob"
3. Configure **Games Refresh**:
   - Title: `BetStreaks - Refresh Games`
   - URL: `https://[your-project-ref].supabase.co/functions/v1/refresh-games-today`
   - Schedule: Every 10 minutes
   - Request Method: POST
   - Headers: Add `x-refresh-secret` with your secret value
4. Configure **Players Refresh**:
   - Title: `BetStreaks - Refresh Players`
   - URL: `https://[your-project-ref].supabase.co/functions/v1/refresh-players-and-streaks`
   - Schedule: Every 3 hours
   - Request Method: POST
   - Headers: Add `x-refresh-secret` with your secret value

## Summary
Your server-side refresh system is complete! The only manual step is setting up the free external cron service. No paid Supabase plan required.
