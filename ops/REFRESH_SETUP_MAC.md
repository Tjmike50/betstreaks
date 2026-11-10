# BetStreaks Local Refresh Setup (macOS)

This guide sets up automated NBA data refresh on a local Mac (e.g., Mac mini) instead of GitHub Actions, avoiding `stats.nba.com` IP blocking issues.

## Existing `com.betstreaks.refresh` LaunchAgent

The separate legacy LaunchAgent calls `~/betstreaks-refresh/run_refresh.sh`
and runs `refresh_players.py` and `refresh_teams.py`. Its replacement is
[`ops/legacy-run-refresh.sh`](legacy-run-refresh.sh).

1. In Supabase **Settings → API Keys**, create a named secret API key for the
   legacy Mac job. In the login Keychain of the user who owns the LaunchAgent,
   create a generic password with service `com.betstreaks.refresh.supabase` and
   account matching `id -un`. Set the password to the new secret API key.
2. Make the item available to `/usr/bin/security` under that user's LaunchAgent
   session. A locked Keychain or denied access causes the launcher to exit before
   either script runs. The installed Python Supabase SDK must support modern keys.
3. Install the replacement from the repository root using the existing script
   path. The plist, times and Python scripts stay in place.

   ```bash
   install -m 700 ops/legacy-run-refresh.sh "$HOME/betstreaks-refresh/.run_refresh.new"
   mv -f "$HOME/betstreaks-refresh/.run_refresh.new" "$HOME/betstreaks-refresh/run_refresh.sh"
   ```

The standalone `refresh_games_today.py` helper also reads
`SUPABASE_SERVICE_ROLE_KEY`. It is outside this LaunchAgent's run sequence.
If retained for separate use, give it the same runtime Keychain injection.

## Repository refresh job

### Overview

| Component | Location |
|-----------|----------|
| Refresh script | `scripts/refresh.py` |
| Shell wrapper | `scripts/run_refresh.sh` |
| LaunchAgent plist | `~/Library/LaunchAgents/com.betstreaks.nba-refresh.plist` |
| Environment file | `~/.config/betstreaks/.env` |
| Logs | `~/Projects/betstreaks/logs/` |

## Prerequisites

- macOS with Python 3.11+
- Git configured with repo access
- Supabase project credentials

---

## 1. Create Environment File

Create the directory and `.env` file:

```bash
mkdir -p -m 700 ~/.config/betstreaks
chmod 700 ~/.config/betstreaks
(umask 077; touch ~/.config/betstreaks/.env)
chmod 600 ~/.config/betstreaks/.env
nano ~/.config/betstreaks/.env
```

Add the values as unquoted `NAME=value` lines. Create a separate named secret API key for this job in **Settings → API Keys**. Use the existing Edge Function `REFRESH_SECRET` for the scoring call.

```env
SUPABASE_URL=https://enhksxikgvvdohseivpx.supabase.co
SUPABASE_REFRESH_API_KEY=your-named-supabase-secret-api-key
REFRESH_SECRET=your-existing-scoring-secret
```

Keep this file outside the repository with mode 600. The wrapper reads it as data. For GitHub Actions, set the same three variable names in **Settings → Secrets and variables → Actions**, using a separate named secret API key for the workflow. The workflow still runs on its configured cadence when enabled.

---

## 2. Set Up Python Environment

```bash
cd ~/Projects/betstreaks

# Create virtual environment (recommended)
python3 -m venv .venv
source .venv/bin/activate

# Install dependencies
pip install -r requirements.txt
```

---

## 3. Test the Refresh Script

Run manually first to verify everything works:

```bash
# Make executable
chmod +x scripts/run_refresh.sh

# Test run
./scripts/run_refresh.sh

# Check logs
cat logs/refresh_$(date +%Y-%m-%d).log
```

---

## 4. Configure iMessage Alerts (Optional)

Edit `scripts/run_refresh.sh` and set your contact:

```bash
ALERT_CONTACT="+1234567890"  # Phone number
# or
ALERT_CONTACT="you@icloud.com"  # iMessage email
```

**Note:** First-time use requires granting Terminal/script access to Messages.

---

## 5. Install LaunchAgent

```bash
# Copy plist to LaunchAgents
cp ops/com.betstreaks.nba-refresh.plist ~/Library/LaunchAgents/

# Replace USER_HOME placeholder with your actual home directory
sed -i '' "s|USER_HOME|$HOME|g" ~/Library/LaunchAgents/com.betstreaks.nba-refresh.plist

# Create logs directory
mkdir -p ~/Projects/betstreaks/logs

# Load the agent
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.betstreaks.nba-refresh.plist
```

---

## 6. Verify LaunchAgent is Loaded

```bash
# Check if loaded
launchctl list | grep betstreaks

# Should show something like:
# -    0    com.betstreaks.nba-refresh
```

---

## 7. LaunchAgent Commands

### Start/Stop

```bash
# Manually trigger a run (for testing)
launchctl kickstart gui/$(id -u)/com.betstreaks.nba-refresh

# Stop the agent (unload)
launchctl bootout gui/$(id -u)/com.betstreaks.nba-refresh

# Reload after editing plist
launchctl bootout gui/$(id -u)/com.betstreaks.nba-refresh
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.betstreaks.nba-refresh.plist
```

### View Status

```bash
# Check if running
launchctl list | grep betstreaks

# View last exit code (0 = success)
launchctl list com.betstreaks.nba-refresh
```

---

## 8. View Logs

```bash
# Today's application log
cat ~/Projects/betstreaks/logs/refresh_$(date +%Y-%m-%d).log

# LaunchAgent stdout/stderr
cat ~/Projects/betstreaks/logs/launchd-stdout.log
cat ~/Projects/betstreaks/logs/launchd-stderr.log

# Tail logs in real-time
tail -f ~/Projects/betstreaks/logs/refresh_$(date +%Y-%m-%d).log

# All recent logs
ls -la ~/Projects/betstreaks/logs/
```

---

## Schedule

The LaunchAgent runs at:

| Time (ET) | Purpose |
|-----------|---------|
| 3:05 AM | Catch late-night game results |
| 9:05 AM | Morning data refresh |

To change the schedule, edit the plist's `StartCalendarInterval` and reload.

---

## Troubleshooting

### "Operation not permitted" error

Grant Full Disk Access to Terminal:
1. System Preferences → Privacy & Security → Full Disk Access
2. Add Terminal.app

### Script doesn't run at scheduled time

1. Check Mac isn't in sleep mode at scheduled times
2. Verify with `launchctl list | grep betstreaks`
3. Check `launchd-stderr.log` for errors

### Python/pip not found

Ensure PATH in plist includes Homebrew:
```xml
<key>PATH</key>
<string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
```

### iMessage alerts not sending

1. Open Messages.app manually first
2. Grant script access when prompted
3. Test with: `osascript -e 'tell application "Messages" to send "test" to buddy "+1234567890"'`

---

## Disabling GitHub Actions

Once local refresh is working, you can disable the GitHub Actions workflow:

1. Delete `.github/workflows/refresh.yml`, or
2. Add `if: false` to the job, or
3. Rename to `refresh.yml.disabled`

The GitHub Actions workflow will continue to fail with timeouts if left enabled, but won't affect the local refresh.
