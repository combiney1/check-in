#!/usr/bin/env bash
# Serve the app locally and run the Playwright E2E check against system Chrome.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PORT="${PORT:-8765}"
PW_DIR="${PW_DIR:-/tmp/ck-playwright}"

# Install playwright-core outside the project so the app stays dependency-free.
function ensure_playwright {
  [ -d "$PW_DIR/node_modules/playwright-core" ] && return 0 || true
  mkdir -p "$PW_DIR"
  (cd "$PW_DIR" && npm init -y >/dev/null && npm i --silent playwright-core@1)
}

ensure_playwright
SERVER_PID=""
trap 'kill "$SERVER_PID" 2>/dev/null || true' EXIT

# Fresh server per spec so relay counts from one suite never leak into the next.
function start_server {
  kill "$SERVER_PID" 2>/dev/null || true
  wait "$SERVER_PID" 2>/dev/null || true
  python3 "$ROOT/server.py" --host 127.0.0.1 --port "$PORT" --quiet &
  SERVER_PID=$!
  sleep 1
}

for spec in "$ROOT"/tests/e2e/*.e2e.mjs; do
  echo "== $(basename "$spec")"
  start_server
  BASE_URL="http://127.0.0.1:$PORT" PLAYWRIGHT_CORE="$PW_DIR/node_modules/playwright-core" node "$spec"
done
