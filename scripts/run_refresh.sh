#!/bin/bash
# =============================================================================
# BetStreaks NBA Data Refresh - Local Mac Runner
# =============================================================================
# Runs refresh.py with proper environment, logging, and optional iMessage alert.
# Exit codes are preserved from python for launchd to detect failures.
# =============================================================================

set +x
set -euo pipefail

# ---- Configuration ----
REPO_DIR="${HOME}/Projects/betstreaks"
ENV_FILE="${HOME}/.config/betstreaks/.env"
LOG_DIR="${REPO_DIR}/logs"
VENV_DIR="${REPO_DIR}/.venv"
PYTHON_SCRIPT="${REPO_DIR}/scripts/refresh.py"

# iMessage alert config (leave empty to disable)
ALERT_CONTACT=""  # Set to phone number or email for iMessage alerts

# ---- Setup ----
DATE_STR=$(date +%Y-%m-%d)
TIMESTAMP=$(date +%Y-%m-%d_%H-%M-%S)
LOG_FILE="${LOG_DIR}/refresh_${DATE_STR}.log"

mkdir -p "${LOG_DIR}"

log() {
    echo "[${TIMESTAMP}] $1" | tee -a "${LOG_FILE}"
}

send_imessage_alert() {
    local message="$1"
    if [[ -n "${ALERT_CONTACT}" ]]; then
        osascript -e "tell application \"Messages\" to send \"${message}\" to buddy \"${ALERT_CONTACT}\""
        log "iMessage alert sent to ${ALERT_CONTACT}"
    fi
}

# ---- Main ----
{
    log "=========================================="
    log "NBA Refresh Started"
    log "=========================================="
    
    # Change to repo directory
    cd "${REPO_DIR}" || { log "ERROR: Cannot cd to ${REPO_DIR}"; exit 1; }
    log "Working directory: $(pwd)"
    
    # Log current git state
    log "Git branch: $(git branch --show-current)"
    log "Git commit: $(git rev-parse --short HEAD)"
    log "Git status: $(git status --porcelain | wc -l | tr -d ' ') uncommitted changes"
    
    # Optional: pull latest (uncomment if desired)
    # log "Pulling latest from origin..."
    # git pull origin main --ff-only
    
    # Treat the owner-only configuration as data, never as shell code.
    if [[ ! -f "${ENV_FILE}" || -L "${ENV_FILE}" ]] ||
       [[ "$(stat -f '%u:%Lp' "${ENV_FILE}")" != "$(id -u):600" ]]; then
        log "ERROR: Expected a regular configuration file owned by this user with mode 600"
        exit 1
    fi
    unset SUPABASE_URL SUPABASE_REFRESH_API_KEY REFRESH_SECRET SUPABASE_SERVICE_ROLE_KEY
    while IFS= read -r line || [[ -n "${line}" ]]; do
        case "${line}" in
            SUPABASE_URL=*) export SUPABASE_URL="${line#*=}" ;;
            SUPABASE_REFRESH_API_KEY=*) export SUPABASE_REFRESH_API_KEY="${line#*=}" ;;
            REFRESH_SECRET=*) export REFRESH_SECRET="${line#*=}" ;;
            ""|\#*) ;;
            *) log "ERROR: Unexpected entry in refresh configuration"; exit 1 ;;
        esac
    done < "${ENV_FILE}"
    unset line

    if [[ -z "${SUPABASE_URL:-}" || -z "${SUPABASE_REFRESH_API_KEY:-}" || -z "${REFRESH_SECRET:-}" ]]; then
        log "ERROR: Set SUPABASE_URL, SUPABASE_REFRESH_API_KEY and REFRESH_SECRET"
        exit 1
    fi

    # Setup Python environment
    if [[ -d "${VENV_DIR}" ]]; then
        log "Activating virtual environment: ${VENV_DIR}"
        # shellcheck source=/dev/null
        source "${VENV_DIR}/bin/activate"
    else
        log "No venv found, using system Python"
    fi
    
    log "Python: $(which python)"
    log "Python version: $(python --version)"
    
    # Install/update dependencies
    log "Checking dependencies..."
    pip install -q -r "${REPO_DIR}/requirements.txt"
    
    # Run the refresh script
    log "Starting refresh.py..."
    log "------------------------------------------"
    
    python "${PYTHON_SCRIPT}"
    PYTHON_EXIT_CODE=$?
    
    log "------------------------------------------"
    
    if [[ ${PYTHON_EXIT_CODE} -eq 0 ]]; then
        log "Refresh completed successfully"
    else
        log "ERROR: Refresh failed with exit code ${PYTHON_EXIT_CODE}"
        send_imessage_alert "🚨 BetStreaks NBA refresh FAILED (exit ${PYTHON_EXIT_CODE}). Check logs: ${LOG_FILE}"
        exit ${PYTHON_EXIT_CODE}
    fi
    
    log "=========================================="
    log "NBA Refresh Finished"
    log "=========================================="
    
} 2>&1 | tee -a "${LOG_FILE}"

# Preserve exit code
exit ${PIPESTATUS[0]}
