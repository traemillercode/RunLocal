// Run Local server — serves the built SPA (dist/) AND the identity/safety API
// on the team's single public origin (0.0.0.0:3000). Zero dependencies.
//
// Env:
//   RUN_LOCAL_ROOT            static root (default ./dist)
//   RUN_LOCAL_PORT            port (default 3000; deliberately not `PORT`)
//   RUN_LOCAL_DATA_DIR        data + uploads directory (default ./data)
//   RUN_LOCAL_RETENTION_YEARS retention window for verification records (default 3)
//   VITE_SUPABASE_URL         Supabase project URL (browser-safe; also embedded
//                             in the client bundle by Vite at build time)
//   VITE_SUPABASE_ANON_KEY    Supabase PUBLIC anon key (browser-safe; also
//                             embedded in the client bundle by Vite)
//   RUN_LOCAL_MIN_AGE         minimum signup age (default 16)
//   RUN_LOCAL_ADMIN_KEY       admin key for the safety tool (server-side only)
//   RUN_LOCAL_ADMIN_EMAIL     admin identity shown in the audit log
//
// Email OTP verification is delivered by Supabase Auth (signInWithOtp /
// verifyOtp). The server validates the resulting access token against
// Supabase's /auth/v1/user endpoint using only the public anon key — no
// service_role key or other secret is ever used or stored.
//
// NOTE: private uploads (selfies) live under <data>/uploads/private and are
// deliberately NOT reachable through the static handler — only the audited
// admin selfie endpoint can read them.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { Db } from "./src/server/store";
import { apiHandler, pruneSessionsWith } from "./src/server/api";
import { purgeEligible } from "./src/server/retention";

const root = normalize(process.env.RUN_LOCAL_ROOT ?? join(import.meta.dirname, "dist"));
const port = Number(process.env.RUN_LOCAL_PORT ?? 3000);
const dataDir = normalize(process.env.RUN_LOCAL_DATA_DIR ?? join(import.meta.dirname, "data"));
const retentionYears = Math.max(1, Number(process.env.RUN_LOCAL_RETENTION_YEARS ?? 3) || 3);

const db = new Db({ dataDir, retentionYears });
await db.load();

// Retention purge on boot, then daily. Never keep verification data forever.
let lastPurge = 0;
async function runRetentionPurge(): Promise<void> {
  const started = Date.now();
  const { purged } = await purgeEligible(db, new Date());
  const removedSessions = pruneSessionsWith(db);
  await db.persist();
  if (purged.length > 0 || removedSessions > 0) {
    // Log counts only — never account ids, phones, or selfie references.
    console.log(`[retention] purged ${purged.length} eligible record(s), pruned ${removedSessions} stale session(s) in ${Date.now() - started}ms`);
  }
  lastPurge = Date.now();
}
await runRetentionPurge();
const purgeInterval = setInterval(() => void runRetentionPurge(), 24 * 60 * 60 * 1000);
purgeInterval.unref();

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json",
  ".json": "application/json",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".jpg": "image/jpeg",
};

const server = createServer(async (req, res) => {
  try {
    // 1) API + admin endpoints (same origin as the SPA).
    if (await apiHandler(req, res, db)) return;

    // 2) Static files — SPA fallback for unknown paths (hash router owns
    //    routing), plus public uploads. Private uploads are never served here.
    const url = new URL(req.url ?? "/", "http://localhost");
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === "/") pathname = "/index.html";

    // Public profile photos live under <data>/uploads/public and are served
    // directly. The private dir (selfies) is unreachable via HTTP — only the
    // audited admin selfie endpoint can read those files.
    if (pathname.startsWith("/uploads/")) {
      const up = normalize(pathname);
      if (!up.startsWith("/uploads/public/")) {
        res.writeHead(404).end();
        return;
      }
      const upFile = normalize(join(dataDir, up.slice(1)));
      if (!upFile.startsWith(join(dataDir, "uploads/public"))) {
        res.writeHead(403).end();
        return;
      }
      try {
        const upData = await readFile(upFile);
        const upExt = extname(upFile);
        res.writeHead(200, { "content-type": TYPES[upExt] ?? "application/octet-stream", "cache-control": "public, max-age=3600" });
        res.end(upData);
        return;
      } catch {
        res.writeHead(404).end();
        return;
      }
    }

    const filePath = normalize(join(root, pathname));
    if (!filePath.startsWith(root)) {
      res.writeHead(403).end();
      return;
    }
    let data: Buffer;
    try {
      data = await readFile(filePath);
    } catch {
      data = await readFile(join(root, "index.html"));
    }
    const ext = extname(filePath);
    res.writeHead(200, {
      "content-type": TYPES[ext] ?? "application/octet-stream",
      "cache-control": ext === ".html" ? "no-cache" : "public, max-age=3600",
    });
    res.end(data);
  } catch {
    if (!res.headersSent) res.writeHead(500).end("server error");
    else res.end();
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Run Local serving ${root} on http://0.0.0.0:${port} (data: ${dataDir}, retention: ${retentionYears}y)`);
});
