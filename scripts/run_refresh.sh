#!/bin/bash
# =============================================================================
# BetStreaks NBA Data Refresh - Local Mac Runner
# =============================================================================
# Runs refresh.py with proper environment, logging, and optional iMessage alert.
# Exit codes are preserved from python for launchd to detect failures.
# =============================================================================

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
    
    # Load environment variables
    if [[ ! -f "${ENV_FILE}" ]]; then
        log "ERROR: Environment file not found: ${ENV_FILE}"
        exit 1
    fi
    log "Loading env from ${ENV_FILE}"
    set -a
    # shellcheck source=/dev/null
    source "${ENV_FILE}"
    set +a
    
    # Verify required vars are set
    if [[ -z "${SUPABASE_URL:-}" ]] || [[ -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ]]; then
        log "ERROR: Missing required env vars (SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY)"
        exit 1
    fi
    log "Environment loaded (SUPABASE_URL is set)"
    
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
