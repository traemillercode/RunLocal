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
import { sendWeeklyPlanEmail } from "./src/server/weeklyPlanEmail";
import { seedContentRegistry, seedSampleFlags } from "./src/server/contentSeed";
import { materializeSeedEvents } from "./src/server/events";
import { materializeSeedRaces } from "./src/server/races";
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
materializeSeedRaces(db);
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

async function runReminderCheck() {
  const notified = db.checkRunReminders(new Date());
  if (notified > 0) {
    await db.persist();
    console.log(`[reminders] notified ${notified} upcoming-run attendee(s)`);
  }
}
await runReminderCheck();
const reminderInterval = setInterval(() => void runReminderCheck(), 10 * 60 * 1000);
reminderInterval.unref();

async function runWeeklyPlanEmailCheck() {
  const due = db.listAccountsDueForWeeklyPlanEmail(new Date());
  let sent = 0;
  for (const { accountId, weekStartDate } of due) {
    const result = await sendWeeklyPlanEmail(db, accountId, weekStartDate, "", "automatic", null, new Date());
    if (result.ok) sent++;
  }
  if (due.length > 0) {
    await db.persist();
    console.log(`[weekly-plan-email] ${sent}/${due.length} automatic weekly plan email(s) sent`);
  }
}
await runWeeklyPlanEmailCheck();
// Hourly is plenty - this only needs day-level granularity (fires once per account per week-start day), unlike run reminders which need to catch a specific upcoming time window.
const weeklyPlanEmailInterval = setInterval(() => void runWeeklyPlanEmailCheck(), 60 * 60 * 1000);
weeklyPlanEmailInterval.unref();

/**
 * Canonical host redirect.
 *
 * Three hostnames currently serve identical content (the Railway service
 * domain, the apex, and www) with no redirects. That's not just duplicate
 * content: PostHog's persistence is localStorage+cookie, and BOTH are
 * origin-scoped — so the same runner on www and apex is two people with two
 * consent states, gets the cookie banner twice, and splits every funnel.
 * It also scatters SEO authority across three domains, which would make the
 * prerendering work in 2.12 largely pointless.
 *
 * Set CANONICAL_HOST (e.g. "getkimbio.com") to turn this on. Left unset in
 * local dev and preview environments, where redirecting to production would
 * be actively wrong.
 */
const CANONICAL_HOST = process.env.CANONICAL_HOST?.trim().toLowerCase() || null;

function canonicalRedirectTarget(req: import("node:http").IncomingMessage): string | null {
  if (!CANONICAL_HOST) return null;
  // Only document requests. A 301 on POST/PUT is widely re-issued as GET by
  // clients, silently dropping the body — never redirect an API call. The SPA
  // uses same-origin relative URLs, so once the document is on the canonical
  // host every subsequent API call already is too.
  if (req.method !== "GET" && req.method !== "HEAD") return null;
  const rawPath = req.url ?? "/";
  if (rawPath.startsWith("/api/")) return null;

  const forwarded = req.headers["x-forwarded-host"];
  const hostHeader = (Array.isArray(forwarded) ? forwarded[0] : forwarded) ?? req.headers.host ?? "";
  const host = hostHeader.split(",")[0].trim().toLowerCase().replace(/:\d+$/, "");
  if (!host || host === CANONICAL_HOST) return null;
  // Never redirect a local or private-network request, even if the env var is
  // set — that would make a misconfigured deploy impossible to debug locally.
  if (host === "localhost" || host === "127.0.0.1" || host.endsWith(".local")) return null;

  return `https://${CANONICAL_HOST}${rawPath}`;
}

/**
 * Rewrites the canonical link to the ACTUAL route being served.
 *
 * The bug this fixes: index.html shipped a hardcoded
 * `<link rel="canonical" href="https://getkimbio.com/">`, so every route
 * declared itself a duplicate of the homepage. That doesn't just fail to
 * help - it actively instructs Google to drop every event, group, and race
 * page from the index, which is the exact inverse of what the prerendering
 * work in 2.12 is for.
 *
 * Done server-side rather than in the SPA so a crawler sees the right value
 * in the initial HTML without executing JS. Only touches HTML responses.
 */
function rewriteCanonical(data: Buffer, servedPath: string, requestPath: string): Buffer {
  if (!CANONICAL_HOST || !servedPath.endsWith(".html")) return data;

  // Normalize so trivially-different URLs don't self-report as competing
  // canonicals: strip a trailing slash (except root), and collapse an
  // index.html request back to "/".
  let p = requestPath || "/";
  if (p === "/index.html") p = "/";
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  // The canonical is the clean path only - query strings are tracking and
  // filter state, never a distinct document.
  const href = `https://${CANONICAL_HOST}${p}`;

  const html = data.toString("utf8");
  const replaced = html.replace(
    /<link rel="canonical"[^>]*>/i,
    `<link rel="canonical" href="${href}" />`,
  );
  return replaced === html ? data : Buffer.from(replaced, "utf8");
}

const server = createServer(async (req, res) => {
  try {
    // 0) Canonicalize the hostname before anything else, so every downstream
    //    surface (analytics identity, consent, cookies, SEO) sees one origin.
    const redirectTo = canonicalRedirectTarget(req);
    if (redirectTo) {
      res.writeHead(301, { location: redirectTo, "cache-control": "public, max-age=3600" });
      res.end();
      return;
    }

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
    res.end(rewriteCanonical(data, servedPath, url.pathname));
  } catch {
    if (!res.headersSent) res.writeHead(500).end("server error");
    else res.end();
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Run Local serving ${root} on http://0.0.0.0:${port} (data: ${dataDir}, retention: ${retentionYears}y)`);
});
