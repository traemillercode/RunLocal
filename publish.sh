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
# These checks deliberately inspect the published bytes, not only the HTTP status:
# the marketing shell also has a /app route, so a 200 alone can silently publish
# the coming-soon page instead of the functional HashRouter app.
APP_HTML="$(mktemp)"
trap 'rm -f "$APP_HTML"' EXIT
curl -sf http://localhost:3000/app > "$APP_HTML"
grep -Fq '<div id="root"></div>' "$APP_HTML" || { echo 'functional app document marker missing at /app' >&2; exit 1; }
grep -Fq 'src="/app/assets/' "$APP_HTML" || { echo 'functional app bundle mount missing at /app' >&2; exit 1; }
if grep -Fqi 'being prepared for this public home' "$APP_HTML"; then
  echo 'coming-soon shell served at /app' >&2
  exit 1
fi
APP_ASSET="$(sed -n 's/.*src="\(\/app\/assets\/[^" ]*\.js\)".*/\1/p' "$APP_HTML" | head -1)"
[ -n "$APP_ASSET" ] || { echo 'functional app JavaScript asset not found' >&2; exit 1; }
# The bundle is minified, so no component-name string (e.g. 'LoginPage') can
# prove the app mounted — esbuild mangles identifiers away. Instead verify the
# served bundle carries THIS build's BUILD_ID: main.tsx inlines
# import.meta.env.VITE_BUILD_ID as a string literal, which survives minification,
# is unique per publish, and cannot appear in the coming-soon shell or in a
# stale bundle left over from an earlier build.
curl -sf "http://localhost:3000$APP_ASSET" | grep -Fq "$BUILD_ID" || { echo "functional app bundle marker (build $BUILD_ID) missing at /app" >&2; exit 1; }
curl -sf http://localhost:3000/api/health | grep -Fq '"ok":true' || { echo 'public API health check failed' >&2; exit 1; }
# Hash routes are client-side, but the document and splash bridges must be real.
curl -sf http://localhost:3000/login | grep -Fq '/app#/login' || { echo 'login bridge missing' >&2; exit 1; }
curl -sf http://localhost:3000/signup | grep -Fq '/app#/login?mode=signup' || { echo 'signup bridge missing' >&2; exit 1; }
curl -sf http://localhost:3000/app/sw.js | grep -q 'runlocal-shell-' || { echo 'service worker path/marker verification failed' >&2; exit 1; }
curl -sfI http://localhost:3000/app/sw.js | grep -qi 'content-type: text/javascript' || { echo 'service worker MIME verification failed' >&2; exit 1; }
curl -sfI http://localhost:3000/app/manifest.webmanifest | grep -qi 'cache-control: no-cache' || { echo 'manifest cache verification failed' >&2; exit 1; }
echo "✓ Run Local splash + authenticated app are live on port 3000 (build $BUILD_ID)"
