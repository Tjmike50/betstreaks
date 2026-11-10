# NBA refresh on the designated Mac

Use one Mac LaunchAgent, `com.betstreaks.refresh`, to run the repository's NBA player and team game logs, streaks and streak events. It runs `scripts/refresh.py --game-logs-only` through the repository launcher. The hosted daily pipeline owns the slate, availability and scoring. The optional GitHub runner writes the same game-log datasets and is a backup for the Mac.

The inspected Mac's installed legacy agent runs at 9 a.m., 1 p.m. and 6 p.m. local time and has `RunAtLoad` enabled. The repository plist preserves that label and cadence. Compare the actual target Mac's plist before replacement and preserve any owner-approved timing differences. An earlier repository template used a different label, `com.betstreaks.nba-refresh`. Check both labels when taking inventory.

## Prepare the repository and runtime

Prepare the verified release checkout as the user who will run the LaunchAgent. Python 3.13.13 and the direct dependency versions in `requirements.txt` were tested. Use a working Python 3.13 interpreter and create the virtual environment once. The launcher uses that interpreter directly and installs nothing at launch time.

```bash
python3.13 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python -B -m unittest discover -s ops/tests -p test_refresh.py
```

If the interpreter cannot create its venv or install dependencies, use a working Python installation and recreate the venv. The local Homebrew 3.11/3.12 interpreters did not pass setup during this audit. The verified managed Python 3.13 runtime did. Keep the checkout and its venv at stable paths readable by the user session.

Create private configuration and log directories. Put the approved project HTTPS origin on a single line in `project-url`.

```bash
install -d -m 700 "$HOME/.config/betstreaks" "$HOME/.config/betstreaks/logs"
(umask 077; touch "$HOME/.config/betstreaks/project-url")
chmod 600 "$HOME/.config/betstreaks/project-url"
```

In Supabase, provision a named modern secret API key for the designated Mac. In **Keychain Access** under the LaunchAgent owner's login session, create a generic password in the login Keychain with service `com.betstreaks.refresh.supabase`, account equal to that user's short username, and the new key as its password. Permit `/usr/bin/security` to read that item under the scheduled session. Confirm access for that item only. Keep the value out of shell history, process arguments and configuration files.

Run the repository preflight as the same macOS user with their login Keychain available.

```bash
scripts/run_refresh.sh --check-config
```

The preflight checks private configuration, the Keychain item and Python imports without contacting Supabase or NBA services. A missing/locked Keychain item or an access prompt that cannot complete produces a nonzero exit. The launcher uses a ten-second Keychain lookup timeout and an exclusive file lock. Missing venv, bad URL, concurrent launch or a provider failure yields a nonzero exit. Successful staging writes are tracked through `refresh_status` ID 1. The supplied local tests stub Keychain and provider calls. Repeat the preflight from the actual installed account before switching writers.

## Switch one writer at a time

1. Confirm both GitHub workflows are disabled or gated, and confirm no hosted or external job invokes the Python game-log runner. The repository GitHub job also requires `BETSTREAKS_NBA_REFRESH_RUNNER=github` on the default branch. The separate `betstreaks-refresh` repository needs its own disabled state checked.
2. In the cutover window, unload the existing legacy LaunchAgent and any alternate template agent. Check that their processes have exited. The legacy launcher and its three Python helpers read the legacy service-role variable. Retire that directory from scheduled use and quarantine the plaintext credential under the incident procedure. `ops/legacy-run-refresh.sh` is a safe retirement stub for an old path if needed.
3. Prepare the replacement plist from the repository template. The following creates a local candidate at the checkout root. It fills the checkout and home paths without placing credential values in the file.

   ```bash
   .venv/bin/python - <<'PY'
   from pathlib import Path
   import plistlib

   root = Path.cwd().resolve()
   config = plistlib.loads((root / "ops/com.betstreaks.refresh.plist").read_bytes())
   config["ProgramArguments"][1] = str(root / "scripts/run_refresh.sh")
   for name in ("StandardOutPath", "StandardErrorPath"):
       config[name] = config[name].replace("USER_HOME", str(Path.home()))
   out = Path.home() / ".config/betstreaks/com.betstreaks.refresh.plist"
   out.write_bytes(plistlib.dumps(config))
   PY
   plutil -lint "$HOME/.config/betstreaks/com.betstreaks.refresh.plist"
   ```

4. Install the prepared file as `~/Library/LaunchAgents/com.betstreaks.refresh.plist` and bootstrap it under `gui/$(id -u)` when the owner authorizes the first write. **Bootstrap starts a refresh immediately** because of `RunAtLoad`. Before using `launchctl kickstart`, verify the previous run has ended. The lock rejects overlap on the same Mac.
5. Check `launchctl list com.betstreaks.refresh` for exit status and `~/.config/betstreaks/logs/` for sanitized messages. In the authorized environment, verify player/team log dates, streak counts and ID 1 refresh timing. If the source fetch or filtering returns an empty required dataset, the script fails before the first write. The existing streak replacement still uses separate delete and insert operations. If a database write fails partway through, pause the runner, check recent writes against the last successful run and repeat with the same modern key after resolving the cause.

To switch to GitHub as backup, unload the Mac and confirm its run has drained first. Enable only the main repository workflow with `BETSTREAKS_NBA_REFRESH_RUNNER=github` and its own named key in `SUPABASE_REFRESH_API_KEY`, plus the approved `SUPABASE_URL`. GitHub serializes runs in that workflow. Mac and hosted jobs require a separate ownership check during every switch. Reverse the sequence to return to the Mac and confirm GitHub is idle before bootstrapping. Follow the [cutover runbook](SECURITY_RELEASE_RUNBOOK.md) for recovery and scheduler coordination.
