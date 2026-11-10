#!/bin/bash
# Drop-in launcher for the separately installed com.betstreaks.refresh job.
set +x
set -euo pipefail
umask 077

cd "${HOME}/betstreaks-refresh"
export SUPABASE_URL="https://enhksxikgvvdohseivpx.supabase.co"

# Older local Python scripts read this variable name. Inject a modern, named
# secret API key under it at runtime.
if ! SUPABASE_SERVICE_ROLE_KEY=$(/usr/bin/security find-generic-password \
    -s com.betstreaks.refresh.supabase -a "$(/usr/bin/id -un)" -w 2>/dev/null) ||
   [[ "${SUPABASE_SERVICE_ROLE_KEY}" != sb_secret_?* ]]; then
    echo "ERROR: The NBA refresh secret is missing or inaccessible in Keychain" >&2
    exit 1
fi
export SUPABASE_SERVICE_ROLE_KEY

# Attempt both refreshes, as the original job did. Report either failure.
status=0
/usr/bin/python3 refresh_players.py || status=$?
/usr/bin/python3 refresh_teams.py || status=$?
exit "${status}"
