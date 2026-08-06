#!/usr/bin/env bash
# Build the authenticated app, run it privately, then publish the public
# splash/proxy which mounts the app at /app and its same-origin API at /api.
set -euo pipefail
cd "$(dirname "$0")"

echo "→ Building (typecheck + vite build)"
BUILD_ID="$(git rev-parse --short HEAD)-$(date -u +%Y%m%d%H%M%S)"
export VITE_BUILD_ID="$BUILD_ID"
bun run build
sed -i "s/__BUILD_ID__/$BUILD_ID/g" dist/sw.js

echo "→ Freeing app port 3001"
sudo sh -c 'lsof -t -iTCP:3001 -sTCP:LISTEN | xargs -r kill' 2>/dev/null || true
mkdir -p .run
setsid nohup env RUN_LOCAL_PORT=3001 \
  VITE_SUPABASE_URL="${VITE_SUPABASE_URL:-}" \
  VITE_SUPABASE_ANON_KEY="${VITE_SUPABASE_ANON_KEY:-}" \
  bun run serve.ts > .run/server.log 2>&1 &
sleep 2

echo "→ Publishing public splash/proxy on port 3000"
cd /home/team/shared/site
bun run publish

echo "→ Verifying public app mount"
curl -sfI http://localhost:3000/ | head -3
curl -sfI http://localhost:3000/app | head -3
curl -sf http://localhost:3000/app | grep -q 'Run Local' 
curl -sf http://localhost:3000/app/sw.js | grep -q 'runlocal-shell-' || { echo 'service worker path/marker verification failed' >&2; exit 1; }
curl -sfI http://localhost:3000/app/sw.js | grep -qi 'content-type: text/javascript' || { echo 'service worker MIME verification failed' >&2; exit 1; }
curl -sfI http://localhost:3000/app/manifest.webmanifest | grep -qi 'cache-control: no-cache' || { echo 'manifest cache verification failed' >&2; exit 1; }
echo "✓ Run Local splash + authenticated app are live on port 3000 (build $BUILD_ID)"
