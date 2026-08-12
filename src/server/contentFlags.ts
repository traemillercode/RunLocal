/**
 * Generic content-report flagging — verified runners flag public content for
 * admin review.
 *
 * Contract:
 *  - ONLY verified runners (not deleted, not suspended) may flag, and only
 *    content in their OWN home city (cross-city is denied — never redirected);
 *  - the reason is required and validated 5–500 chars;
 *  - self-reporting is blocked (a runner cannot flag their own post / reply /
 *    event / race / group);
 *  - duplicate-protected: an existing OPEN (unresolved) flag from the same
 *    reporter for the same target returns 409;
 *  - rate-limited via a dedicated shared bucket (5 flags / hour / account);
 *  - the created FlagRecord keeps the reporter identity + reason — those fields
 *    are ADMIN-ONLY in every view (see dashboard.ts flagView); the create
 *    response carries only the flag id/status, never the reason or reporter.
 *
 * Targets: post / reply / event / race / group. Posts, events, and races map
 * to the moderation registry (`post:<id>` / `event:<id>` / `race:<id>` rows);
 * replies and groups have no registry row and use `kind + id` directly
 * (`reply:<id>` / the group id). Every flag creation is audited
 * (`content.flag`) with the reporter identity, city, and change summary.
 */
import type { Db } from "./store";
import { isSuspended } from "./store";
import type { AccountRecord, ContentRecord, FlagKind, FlagRecord } from "./types";
import { REASON_MAX, REASON_MIN } from "./admin";

export const FLAG_REASON_MIN = REASON_MIN;
export const FLAG_REASON_MAX = REASON_MAX;
export const FLAG_RATE_LIMIT = 5;

export type FlagTargetKind = "post" | "reply" | "event" | "race" | "group";

export type ContentFlagResult =
  | { ok: true; data: { flag: { id: string; status: FlagRecord["status"]; contentId: string; kind: FlagKind } } }
  | { ok: false; status: number; error: string; message?: string };

/** Public-safe creation view — never echoes the reporter's reason or identity. */
function publicFlagView(f: FlagRecord) {
  return { id: f.id, status: f.status, contentId: f.contentId, kind: f.kind };
}

interface FlagTarget {
  contentId: string;
  kind: FlagKind;
  refId: string;
  title: string;
  cityId: string;
  /** Account that authored/owns the target (self-report check). */
  ownerAccountId: string | null;
  /** Owner email for the audit trail. */
  ownerEmail: string | null;
}

function resolveTarget(db: Db, kind: FlagTargetKind, id: string): FlagTarget | null {
  if (kind === "post") {
    const content = db.getContent(`post:${id}`);
    if (!content) return null;
    return {
      contentId: content.id,
      kind: "post",
      refId: content.refId,
      title: content.title,
      cityId: content.cityId,
      ownerAccountId: content.authorAccountId,
      ownerEmail: content.authorAccountId ? db.getAccount(content.authorAccountId)?.email ?? null : null,
    };
  }
  if (kind === "reply") {
    const reply = db.getForumReply(id);
    if (!reply) return null;
    const parent = db.getContent(`post:${reply.postId}`);
    return {
      contentId: `reply:${reply.id}`,
      kind: "reply",
      refId: reply.id,
      title: parent?.title ?? "Forum reply",
      cityId: reply.cityId,
      ownerAccountId: reply.authorAccountId,
      ownerEmail: db.getAccount(reply.authorAccountId)?.email ?? null,
    };
  }
  if (kind === "event") {
    const content = resolveEventContent(db, id);
    if (!content) return null;
    return {
      contentId: content.id,
      kind: "event",
      refId: content.refId,
      title: content.title,
      cityId: content.cityId,
      ownerAccountId: content.authorAccountId,
      ownerEmail: content.authorAccountId ? db.getAccount(content.authorAccountId)?.email ?? null : null,
    };
  }
  if (kind === "race") {
    const content = db.getContent(`race:${id}`);
    if (!content) return null;
    return {
      contentId: content.id,
      kind: "race",
      refId: content.refId,
      title: content.title,
      cityId: content.cityId,
      ownerAccountId: content.authorAccountId,
      ownerEmail: content.authorAccountId ? db.getAccount(content.authorAccountId)?.email ?? null : null,
    };
  }
  // group — no registry row; the group record is the target.
  const group = db.getGroup(id);
  if (!group) return null;
  return {
    contentId: group.id,
    kind: "group",
    refId: group.id,
    title: group.name,
    cityId: group.cityId,
    ownerAccountId: group.ownerId ?? null,
    ownerEmail: group.ownerId ? db.getAccount(group.ownerId)?.email ?? null : null,
  };
}

/** Registry row for an event, accepting the registry id or a canonical event id. */
function resolveEventContent(db: Db, id: string): ContentRecord | null {
  const direct = db.getContent(`event:${id}`);
  if (direct) return direct;
  const ev = db.listEvents().find((e) => e.id === id || e.seedRefId === id);
  if (!ev) return null;
  return db.getContent(`event:${ev.seedRefId ?? ev.id}`) ?? null;
}

/**
 * Create a content-report flag. `reporter` is the resolved signed-in account
 * (the API layer already requires a session); every permission is re-checked
 * here server-side against the stored record.
 */
export function createContentFlag(
  db: Db,
  reporter: AccountRecord,
  input: { kind?: unknown; id?: unknown; reason?: unknown },
  now = new Date(),
): ContentFlagResult {
  if (reporter.deletedAt || reporter.status !== "verified") {
    return { ok: false, status: 403, error: "verified_runner_required", message: "Only verified runners can flag content." };
  }
  if (isSuspended(reporter, now)) {
    return { ok: false, status: 403, error: "suspended", message: "Your account is suspended and can't flag content right now." };
  }
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (reason.length < FLAG_REASON_MIN || reason.length > FLAG_REASON_MAX) {
    return { ok: false, status: 400, error: "invalid_reason", message: `Say why you're flagging this (${FLAG_REASON_MIN}-${FLAG_REASON_MAX} characters).` };
  }
  const kind = typeof input.kind === "string" && (["post", "reply", "event", "race", "group"] as const).includes(input.kind as FlagTargetKind) ? (input.kind as FlagTargetKind) : null;
  const id = typeof input.id === "string" ? input.id.trim() : "";
  if (!kind || !id) return { ok: false, status: 400, error: "invalid_target" };
  const target = resolveTarget(db, kind, id);
  if (!target) return { ok: false, status: 404, error: "not_found", message: "That content isn't available to flag." };
  if (target.cityId !== reporter.cityId) {
    return { ok: false, status: 403, error: "cross_city_denied", message: "Flags stay within your home city's content." };
  }
  if (target.ownerAccountId !== null && target.ownerAccountId === reporter.id) {
    return { ok: false, status: 403, error: "self_report_blocked", message: "You can't flag your own content." };
  }
  if (db.listFlags().some((f) => f.reporterAccountId === reporter.id && f.contentId === target.contentId && f.status === "open")) {
    return { ok: false, status: 409, error: "duplicate_flag", message: "You already flagged this — an admin is reviewing it." };
  }
  // Rate limit counts SUCCESSFUL flag creations only — a duplicate (409 above)
  // or any earlier denial must not burn a slot in the rolling hour.
  if (!db.consumeContentFlagRate(reporter.id, now.getTime(), FLAG_RATE_LIMIT)) {
    return { ok: false, status: 429, error: "rate_limited", message: "You've flagged a lot recently — try again in a bit." };
  }
  const flag = db.appendFlag(
    {
      cityId: target.cityId,
      contentId: target.contentId,
      kind: target.kind,
      refId: target.refId,
      title: target.title,
      reason: reason.slice(0, FLAG_REASON_MAX),
      reporterName: reporter.name,
      reporterAccountId: reporter.id,
      status: "open",
      resolvedAt: null,
      resolvedAction: null,
    },
    now,
  );
  db.appendAudit(
    {
      admin: reporter.email,
      action: "content.flag",
      reason: reason.slice(0, FLAG_REASON_MAX),
      targetId: target.contentId,
      ip: "member-action",
      cityId: target.cityId,
      owner: target.ownerEmail,
      change: `flagged ${target.kind} "${target.title.slice(0, 80)}" (flag ${flag.id})`,
    },
    now,
  );
  return { ok: true, data: { flag: publicFlagView(flag) } };
}
