#!/usr/bin/env bash
# Build and publish Run Local to the team's public surface (port 3000).
# Always takes over port 3000 from whatever is currently serving there.
set -euo pipefail
cd "$(dirname "$0")"

echo "→ Building (typecheck + vite build)"
bun run build

echo "→ Freeing port 3000"
sudo sh -c 'lsof -t -iTCP:3000 -sTCP:LISTEN | xargs -r kill' 2>/dev/null || true
sleep 1

echo "→ Starting static server (detached)"
mkdir -p .run
setsid nohup bun run serve.ts > .run/server.log 2>&1 &
sleep 2

echo "→ Verifying"
curl -sfI http://localhost:3000/ | head -3
curl -s http://localhost:3000/ | grep -o "<title>[^<]*</title>" || true
echo "✓ Run Local is live on port 3000 (log: .run/server.log)"
