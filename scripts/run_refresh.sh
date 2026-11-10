#!/bin/bash
set +x
set -euo pipefail

repo_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
python="${repo_dir}/.venv/bin/python"
if [[ ! -x "$python" ]]; then
  printf '%s\n' 'NBA refresh requires the repository virtual environment. See ops/REFRESH_SETUP_MAC.md.' >&2
  exit 1
fi
exec "$python" -E -s "${repo_dir}/scripts/refresh_macos.py" "$@"
