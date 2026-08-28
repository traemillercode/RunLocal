#!/usr/bin/env bash
# Build the authenticated app, run it privately, then publish the public
# splash/proxy which mounts the app at the site root and its same-origin API at /api.
set -euo pipefail
cd "$(dirname "$0")"
# Repo root, captured before any later `cd` (the site publish below changes the
# working directory, which previously made relative fixture discovery silently
# skip the real upload fixture and never exercise the /uploads proxy).
REPO_ROOT="$(pwd)"

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
# the marketing shell also renders at root for signed-out visitors, so a 200 alone can silently publish
# the coming-soon page instead of the functional HashRouter app.
APP_HTML="$(mktemp)"
trap 'rm -f "$APP_HTML"' EXIT
curl -sf http://localhost:3000/ > "$APP_HTML"
grep -Fq '<div id="root"></div>' "$APP_HTML" || { echo 'functional app document marker missing at /' >&2; exit 1; }
grep -Fq 'src="/assets/' "$APP_HTML" || { echo 'functional app bundle mount missing at /' >&2; exit 1; }
if grep -Fqi 'being prepared for this public home' "$APP_HTML"; then
  echo 'coming-soon shell served at /' >&2
  exit 1
fi
APP_ASSET="$(sed -n 's/.*src="\(\/assets\/[^" ]*\.js\)".*/\1/p' "$APP_HTML" | head -1)"
[ -n "$APP_ASSET" ] || { echo 'functional app JavaScript asset not found' >&2; exit 1; }
# The bundle is minified, so no component-name string (e.g. 'LoginPage') can
# prove the app mounted — esbuild mangles identifiers away. Instead verify the
# served bundle carries THIS build's BUILD_ID: main.tsx inlines
# import.meta.env.VITE_BUILD_ID as a string literal, which survives minification,
# is unique per publish, and cannot appear in the coming-soon shell or in a
# stale bundle left over from an earlier build.
curl -sf "http://localhost:3000$APP_ASSET" | grep -Fq "$BUILD_ID" || { echo "functional app bundle marker (build $BUILD_ID) missing at /" >&2; exit 1; }
curl -sf http://localhost:3000/api/health | grep -Fq '"ok":true' || { echo 'public API health check failed' >&2; exit 1; }
# Verify the public upload proxy with a fixture when one is available. The
# gate must not assume seeded data exists in every environment, but when a
# fixture IS present it must really be tested: the earlier `cd` into the site
# dir made a relative find silently skip the real fixture, so discovery
# resolves the repo-relative path explicitly.
UPLOAD_FIXTURE="$(find "$REPO_ROOT/data/uploads/public" -type f -print -quit 2>/dev/null || true)"
if [ -n "$UPLOAD_FIXTURE" ]; then
  UPLOAD_PATH="/uploads/public/${UPLOAD_FIXTURE#$REPO_ROOT/data/uploads/public/}"
  UPLOAD_HEADERS="$(curl -sfI "http://localhost:3000$UPLOAD_PATH")" || { echo "public upload fixture failed: $UPLOAD_PATH" >&2; exit 1; }
  # A bare 200 is not proof: the splash fallback would happily return the
  # coming-soon HTML for an unproxied path. Require the image content-type AND
  # the exact on-disk bytes so a shell page can never satisfy the gate.
  if ! printf '%s' "$UPLOAD_HEADERS" | grep -qi '^content-type: image/jpeg'; then
    echo "public upload fixture returned a non-image response: $UPLOAD_PATH" >&2
    exit 1
  fi
  if ! curl -sf "http://localhost:3000$UPLOAD_PATH" | cmp -s - "$UPLOAD_FIXTURE"; then
    echo "public upload fixture bytes mismatch: $UPLOAD_PATH" >&2
    exit 1
  fi
  echo "✓ Public upload proxy serves fixture $UPLOAD_PATH (image/jpeg, $(wc -c < "$UPLOAD_FIXTURE") bytes)"
else
  echo "⚠ No public upload fixture found under $REPO_ROOT/data/uploads/public; upload proxy check skipped"
fi
# Hash routes are client-side, but the SSR documents and route-specific
# modulepreloads must prove that the public auth bridges are real. Do not pin
# checks to hashed bundle names or the implementation detail of an href.
LOGIN_HTML="$(curl -sf http://localhost:3000/login)"
printf '%s' "$LOGIN_HTML" | grep -Fq 'auth-bridge' || { echo 'login bridge marker missing' >&2; exit 1; }
printf '%s' "$LOGIN_HTML" | grep -Eq 'rel="modulepreload" href="/assets/login-[^"]+\.js"' || { echo 'login route modulepreload missing' >&2; exit 1; }
printf '%s' "$LOGIN_HTML" | grep -Fq 'Log in to Run Local.' || { echo 'login route heading missing' >&2; exit 1; }
SIGNUP_HTML="$(curl -sf http://localhost:3000/signup)"
printf '%s' "$SIGNUP_HTML" | grep -Fq 'auth-bridge' || { echo 'signup bridge marker missing' >&2; exit 1; }
printf '%s' "$SIGNUP_HTML" | grep -Eq 'rel="modulepreload" href="/assets/signup-[^"]+\.js"' || { echo 'signup route modulepreload missing' >&2; exit 1; }
printf '%s' "$SIGNUP_HTML" | grep -Fq 'Join Run Local.' || { echo 'signup route heading missing' >&2; exit 1; }
curl -sf http://localhost:3000/sw.js | grep -q 'runlocal-shell-' || { echo 'service worker path/marker verification failed' >&2; exit 1; }
curl -sfI http://localhost:3000/sw.js | grep -qi 'content-type: text/javascript' || { echo 'service worker MIME verification failed' >&2; exit 1; }
curl -sfI http://localhost:3000/manifest.webmanifest | grep -qi 'cache-control: no-cache' || { echo 'manifest cache verification failed' >&2; exit 1; }
echo "✓ Run Local splash + authenticated app are live on port 3000 (build $BUILD_ID)"
