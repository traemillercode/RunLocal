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
import { join, normalize } from "node:path";
import { resolveStaticPath, staticHeaders } from "./src/server/static";
import { Db } from "./src/server/store";
import { apiHandler, pruneSessionsWith } from "./src/server/api";
import { purgeEligible } from "./src/server/retention";
import { seedContentRegistry, seedSampleFlags } from "./src/server/contentSeed";
import { materializeSeedEvents } from "./src/server/events";
import { seedCmsCities } from "./src/server/cms";
import { expireCredentials } from "./src/server/trust";

const root = normalize(process.env.RUN_LOCAL_ROOT ?? join(import.meta.dirname, "dist"));
const port = Number(process.env.RUN_LOCAL_PORT ?? 3000);
const dataDir = normalize(process.env.RUN_LOCAL_DATA_DIR ?? join(import.meta.dirname, "data"));
const retentionYears = Math.max(1, Number(process.env.RUN_LOCAL_RETENTION_YEARS ?? 3) || 3);

const db = new Db({ dataDir, retentionYears });
await db.load();

// Mirror the seeded city content into the moderation registry (idempotent,
// preserves owner decisions) and seed the labeled sample flags once.
seedContentRegistry(db);
materializeSeedEvents(db);
seedSampleFlags(db);
// Mirror known city entities into the CMS store (idempotent, preserves admin
// edits; non-launched cities start inactive so only live cities are public).
seedCmsCities(db);
await db.persist();

// Retention purge on boot, then daily. Never keep verification data forever.
let lastPurge = 0;
async function runRetentionPurge(): Promise<void> {
  const started = Date.now();
  expireCredentials(db, new Date());
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
        res.writeHead(200, { ...staticHeaders(upFile), "cache-control": "public, max-age=3600" });
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
    let servedPath = filePath;
    try {
      data = await readFile(filePath);
    } catch {
      // Extensionless OAuth callback is an SPA document, never a binary download.
      servedPath = resolveStaticPath(filePath, join(root, "index.html"), false);
      data = await readFile(servedPath);
    }
    res.writeHead(200, staticHeaders(servedPath));
    res.end(data);
  } catch {
    if (!res.headersSent) res.writeHead(500).end("server error");
    else res.end();
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Run Local serving ${root} on http://0.0.0.0:${port} (data: ${dataDir}, retention: ${retentionYears}y)`);
});
