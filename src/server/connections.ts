/**
 * Connections service — pure functions over the store (no HTTP, no client
 * code). This is the ONLY place that writes connection rows (part B endpoints
 * call these; nothing bypasses them). All six owner edge cases are implemented
 * here and pinned by tests/connections-service.test.ts.
 *
 * One-active-row invariant (store-enforced, service-respected): a pair has at
 * most one ACTIVE row (pending|accepted), keyed by the sorted pair, so A→B and
 * B→A can never coexist. declined/removed rows are retained HISTORY that never
 * blocks a new request — a later request simply supersedes the row.
 */
import { newId, nowIso, type Db } from "./store";
import type { BlockRecord, ConnectionRecord } from "./types";

export type ConnectionState = "none" | "requested_by_me" | "requested_to_me" | "connected" | "removed";

export interface ConnectionActionResult {
  ok: boolean;
  status: "pending" | "accepted" | "declined" | "removed" | "blocked" | "error";
  error?: string;
  connection?: ConnectionRecord;
  /**
   * EDGE CASE 1 report: true when a reverse-direction pending request was
   * auto-resolved to accepted (no second row was created).
   */
  resolved?: boolean;
}

/**
 * Create a connection request from requesterId to addresseeId.
 *
 * EDGE CASE 1: a pending request in the REVERSE direction (addressee →
 * requester) auto-resolves to accepted — the existing row is updated
 * (respondedAt set), no second row is ever created, and the result reports the
 * resolution (`resolved: true`).
 *
 * Blocks: if either user has blocked the other → rejected (no row is written).
 *
 * Idempotency: if an active row already exists (pending or accepted, either
 * direction) → returns the current state without writing.
 */
export function requestConnection(db: Db, requesterId: string, addresseeId: string, now = new Date()): ConnectionActionResult {
  if (requesterId === addresseeId) return { ok: false, status: "error", error: "cannot_connect_self" };
  if (db.isBlocked(requesterId, addresseeId)) return { ok: false, status: "blocked", error: "blocked" };

  const existing = db.getConnectionPair(requesterId, addresseeId);
  if (existing) {
    if (existing.status === "accepted") return { ok: true, status: "accepted", connection: existing };
    if (existing.status === "pending") {
      // Same-direction duplicate → idempotent.
      if (existing.requesterId === requesterId) return { ok: true, status: "pending", connection: existing };
      // EDGE CASE 1: reverse pending → auto-accept the existing row.
      const accepted = db.updateConnection(existing.id, { status: "accepted", respondedAt: nowIso(now) });
      return { ok: true, status: "accepted", connection: accepted ?? existing, resolved: true };
    }
    // declined/removed history → falls through: a fresh pending row supersedes
    // the terminal row (never blocked by it). upsertConnection replaces it.
  }

  const rec: ConnectionRecord = {
    id: newId(),
    requesterId,
    addresseeId,
    status: "pending",
    createdAt: nowIso(now),
    respondedAt: null,
    removedAt: null,
  };
  db.upsertConnection(rec);
  return { ok: true, status: "pending", connection: rec };
}

/**
 * Accept a pending request. ONLY the addressee of the row may act — any other
 * account (or unknown id) gets a not-found result (existence is not leaked).
 * A blocked pair can never become an accepted connection (blocks beat
 * everything), so acceptance is refused while a block exists.
 */
export function acceptConnection(db: Db, accountId: string, requestId: string, now = new Date()): ConnectionActionResult {
  const rec = db.listIncomingRequests(accountId).find((r) => r.id === requestId);
  if (!rec) return { ok: false, status: "error", error: "not_found" };
  if (rec.status !== "pending") return { ok: false, status: "error", error: "not_pending" };
  if (db.isBlocked(accountId, rec.requesterId)) return { ok: false, status: "blocked", error: "blocked" };
  const updated = db.updateConnection(rec.id, { status: "accepted", respondedAt: nowIso(now) });
  return { ok: true, status: "accepted", connection: updated ?? rec };
}

/**
 * Decline a pending request. ONLY the addressee of the row may act.
 * EDGE CASE 3: declining sets status "declined" (respondedAt) — the row is
 * retained as history but NEVER blocks a future request from either side (the
 * one-active-row invariant only covers pending/accepted, so a later
 * requestConnection creates a fresh pending row).
 */
export function declineConnection(db: Db, accountId: string, requestId: string, now = new Date()): ConnectionActionResult {
  const rec = db.listIncomingRequests(accountId).find((r) => r.id === requestId);
  if (!rec) return { ok: false, status: "error", error: "not_found" };
  if (rec.status !== "pending") return { ok: false, status: "error", error: "not_pending" };
  const updated = db.updateConnection(rec.id, { status: "declined", respondedAt: nowIso(now) });
  return { ok: true, status: "declined", connection: updated ?? rec };
}

/**
 * Remove a connection. EDGE CASE 4 — SOFT-DELETE: the active row is marked
 * status "removed" (removedAt set) and NEVER hard-deleted. Afterwards either
 * side may request again (a fresh pending row supersedes the removed history).
 */
export function removeConnection(db: Db, accountId: string, otherId: string, now = new Date()): ConnectionActionResult {
  const active = db.listActiveConnection(accountId, otherId);
  if (!active) return { ok: false, status: "error", error: "not_connected" };
  const updated = db.updateConnection(active.id, { status: "removed", removedAt: nowIso(now) });
  return { ok: true, status: "removed", connection: updated ?? active };
}

/**
 * Block another runner. Writes a BlockRecord through the EXISTING block
 * storage (single block system — no duplicates) AND marks any ACTIVE
 * connection row between the pair as "removed" so blocked pairs never appear
 * as connections. Terminal history (declined) rows are left untouched.
 */
export function blockConnection(db: Db, blockerId: string, blockedId: string, now = new Date()): { ok: true; status: "blocked"; connection?: ConnectionRecord } {
  const record: BlockRecord = { blockerId, blockedId, createdAt: nowIso(now) };
  db.addBlock(record);
  const existing = db.getConnectionPair(blockerId, blockedId);
  if (existing && (existing.status === "pending" || existing.status === "accepted")) {
    const updated = db.updateConnection(existing.id, { status: "removed", removedAt: nowIso(now) });
    return { ok: true, status: "blocked", connection: updated ?? existing };
  }
  return { ok: true, status: "blocked" };
}

/**
 * Accepted connections of viewer ∩ accepted connections of owner.
 * EDGE CASE 2: ANY user blocked by EITHER viewer or owner is excluded from the
 * intersection (a block removes the pair from third-party counts), and the
 * viewer and owner themselves are explicitly excluded (trivially true but
 * explicit). Returns account ids only — minimal for part B.
 */
export function mutualConnections(db: Db, viewerId: string, ownerId: string): string[] {
  const otherSide = (c: ConnectionRecord, selfId: string) => (c.requesterId === selfId ? c.addresseeId : c.requesterId);
  const viewerAccepted = new Set(db.listAcceptedConnections(viewerId).map((c) => otherSide(c, viewerId)));
  const ownerAccepted = new Set(db.listAcceptedConnections(ownerId).map((c) => otherSide(c, ownerId)));
  const mutual: string[] = [];
  for (const id of viewerAccepted) {
    if (id === viewerId || id === ownerId) continue; // explicit self/owner exclusion
    if (!ownerAccepted.has(id)) continue;
    if (db.isBlocked(viewerId, id) || db.isBlocked(ownerId, id)) continue; // EDGE CASE 2
    mutual.push(id);
  }
  return mutual;
}

/**
 * The viewer's relationship state with ownerId for UI copy:
 *  - null           → viewerId is null (guest)
 *  - "none"         → no row (or only a declined history row)
 *  - "requested_by_me" / "requested_to_me" → a pending row, direction-aware
 *  - "connected"    → accepted row
 *  - "removed"      → a removed row exists and nothing newer
 */
export function connectionState(db: Db, viewerId: string | null, ownerId: string): ConnectionState | null {
  if (viewerId === null) return null;
  const pair = db.getConnectionPair(viewerId, ownerId);
  if (!pair) return "none";
  switch (pair.status) {
    case "accepted":
      return "connected";
    case "pending":
      return pair.requesterId === viewerId ? "requested_by_me" : "requested_to_me";
    case "removed":
      return "removed";
    default:
      return "none"; // declined — nothing active, nothing pending
  }
}

/**
 * EDGE CASE 6 — searchability is a SEARCH-INDEX FILTER ONLY, never a
 * visibility gate: `searchable_by_name = false` hides the user from name
 * search for EVERYONE (including their connections), while their
 * profile-by-id and connection views are unaffected (canView stays true for
 * the same pair). Pure helper for the part B search endpoint: a blocked
 * viewer also never sees the target in search (blocks beat everything).
 */
export function searchable(db: Db, viewerId: string | null, targetId: string): boolean {
  if (viewerId !== null && db.isBlocked(viewerId, targetId)) return false;
  return db.getPrivacy(targetId).searchable_by_name === true;
}
