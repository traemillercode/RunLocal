#!/usr/bin/env bun
/**
 * Retention purge — standalone CLI.
 *
 *   bun run retention:purge [--retention-years N] [--data-dir PATH] [--dry-run]
 *
 * Removes verification records (phone, selfie file, public photo, IP history)
 * for accounts that have been inactive (or deleted) past the retention window
 * (default 3 years; override with RUN_LOCAL_RETENTION_YEARS or the flag).
 *
 * The server also runs this on boot and daily; this script exists so an
 * operator can run it on demand (e.g., cron): `0 3 * * * cd /path/to/RunLocal && bun run retention:purge`.
 *
 * Never logs sensitive values — counts only.
 */
import { join } from "node:path";
import { Db } from "../src/server/store";
import { purgeEligible, retentionStatus } from "../src/server/retention";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const dataDir =
  args[args.indexOf("--data-dir") + 1] ?? process.env.RUN_LOCAL_DATA_DIR ?? join(process.cwd(), "data");
const retentionYears =
  Number(args[args.indexOf("--retention-years") + 1] ?? process.env.RUN_LOCAL_RETENTION_YEARS ?? 3) || 3;

const db = new Db({ dataDir, retentionYears });
await db.load();

const status = retentionStatus(db);
const now = new Date();
console.log(
  `[retention:purge] dataDir=${dataDir} retentionYears=${retentionYears} accounts=${status.totalAccounts} eligible=${status.eligibleForPurge} dryRun=${dryRun}`,
);

if (dryRun) {
  console.log("[retention:purge] dry run — nothing was deleted.");
  process.exit(0);
}

const { purged, retained } = await purgeEligible(db, now);
console.log(`[retention:purge] purged=${purged.length} retained=${retained.length}`);
await db.persist();
process.exit(0);
