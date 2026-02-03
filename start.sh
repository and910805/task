#!/bin/bash
set -euo pipefail

echo "== Build frontend =="
cd "$(dirname "$0")/frontend"
npm install
npm run build

echo "== Start backend =="
cd ../backend
export PORT="${PORT:-8080}"
gunicorn --bind 0.0.0.0:$PORT "app:create_app()"
