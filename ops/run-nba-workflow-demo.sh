#!/usr/bin/env bash
set -euo pipefail

demo_port="${NBA_DEMO_PORT:-47962}"
if [[ ! "$demo_port" =~ ^[0-9]{4,5}$ ]] || (( demo_port < 1024 || demo_port > 65535 )); then
  echo "Set NBA_DEMO_PORT to a valid unprivileged port." >&2
  exit 2
fi
demo_origin="http://127.0.0.1:$demo_port"
demo_dist="dist/nba-workflow-demo"

VITE_SUPABASE_URL="$demo_origin" \
  VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_offline_fixture \
  VITE_NBA_WORKFLOW_ENABLED=true VITE_NBA_WORKFLOW_FIXTURE_CONTROLS=true \
  npm run build -- --outDir "$demo_dist"

echo "NBA fixture demo at $demo_origin/research/nba"
exec npx --yes deno@2.5.6 run --frozen --allow-net="127.0.0.1:$demo_port" --allow-read="$demo_dist" \
  ops/analytics-demo.ts "--port=$demo_port" "--static-dir=$demo_dist"
