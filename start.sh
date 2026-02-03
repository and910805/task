#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "== Build frontend =="
cd "$ROOT_DIR/frontend"
npm ci
npm run build

echo "== Start backend (Gunicorn) =="
cd "$ROOT_DIR/backend"
export PORT="${PORT:-5000}"
exec gunicorn --chdir "$ROOT_DIR/backend" -w "${WEB_CONCURRENCY:-2}" --threads "${WEB_THREADS:-4}" -b 0.0.0.0:${PORT} app:app
