/**
 * Admin (global + city-scoped) read/write content management.
 *
 * This is the owner + key-admin + city-admin surface for managing published
 * content — community-submitted races / independent runs / groups, seeded
 * preview races / events / forum posts, run-day discussion comments, and the
 * site announcement:
 *
 *  - list:        routine read of every content row (per city / kind), no
 *                 operator-entered reason required (audited as a routine read);
 *  - edit:        retitle a race / run / group / forum post; for
 *                 community-submitted records the edit propagates to the source
 *                 submission payload (and canonical event / group record) so the
 *                 PUBLIC listing reflects it;
 *  - hide:        remove from public rendering (restorable);
 *  - restore:     reverse a hide (the "unhide" path);
 *  - delete:      soft-delete (terminal archive) of a race / run / group /
 *                 forum post. Dependent content is soft-deleted with the parent
 *                 (event RSVPs/attendance, run-day discussions, ratings, group
 *                 memberships) — rows are preserved for the audit trail, never
 *                 hard-deleted.
 *  - discussion:  edit/remove run-day discussion comments (the only
 *                 server-side comment records in the product);
 *  - announcement: edit/clear the site announcement (site-wide, Global Admin
 *                 only — the announcement is not city-scoped in the data model).
 *
 * Authorization model: every handler uses `authorizeScoped` with
 * `enforceCity` — Global Admin sessions (owner OR key admin) may operate on
 * any city; City Admin sessions may operate ONLY inside their assigned city
 * (cross-city is denied server-side with 403 city_scope_denied). Verified
 * Runners and Group Leaders are denied. Every mutation is reason-required
 * (5–500 chars) and audited with actor/action/target/owner/change/time;
 * routine reads use `routineAdminCtx` so the operator is not prompted for a
 * reason when merely listing content.
 *
 * Public-effect notes:
 *  - Races & forum posts render from the client seed + `/api/moderated`
 *    visibility facts, so hide/restore/delete update `publicModerated`
 *    (deleted ids are included in the public "hidden" list) and any
 *    community-submitted payload edits flow through `/api/content`.
 *  - Canonical events (`RunEventRecord`) are the server source of truth for
 *    `/api/events`; hide/restore/delete sync the canonical record (by id or
 *    seedRefId) so `publicEvents` reflects the decision.
 *  - Groups render from `/api/groups` (`publicGroups`), which filters
 *    `status !== "published"` and `archived` — hide sets status "suspended"
 *    and delete sets `archived`, both of which the public directory honors.
 */
import type { AdminCtx, AdminResult } from "./admin";
import { authorizeScoped, routineAdminCtx } from "./admin";
import { REASON_MAX } from "./admin";
import type { Db } from "./store";
import type { ContentKind, ContentRecord, DiscussionRecord, GroupModRecord, SubmissionRecord } from "./types";
import { DEFAULT_SETTINGS } from "./cms";

export const CONTENT_TITLE_MAX = 100;
export type AdminContentKind = ContentKind | "group";

export interface AdminContentRow {
  /** Registry id — "event:x" / "race:x" / "post:x", or the group id. */
  id: string;
  kind: AdminContentKind;
  refId: string;
  cityId: string;
  title: string;
  authorLabel: string | null;
  /** "seed" (preview fixture) or "submission" (community-submitted). */
  source: "seed" | "submission";
  /** Set when the row derives from an approved community submission. */
  submissionId: string | null;
  hidden: boolean;
  archived: boolean;
  featured: boolean;
  pinned: boolean;
  /** Canonical event lifecycle (event rows only). */
  eventStatus: string | null;
}

function contentRow(c: ContentRecord, db: Db): AdminContentRow {
  const submissionId = c.refId.startsWith("user-") ? c.refId.slice("user-".length) : null;
  const canonicalEvent = c.kind === "event" ? db.listEvents().find((e) => e.id === c.id || e.seedRefId === c.refId) : undefined;
  return {
    id: c.id,
    kind: c.kind,
    refId: c.refId,
    cityId: c.cityId,
    title: c.title,
    authorLabel: c.authorLabel,
    source: submissionId ? "submission" : "seed",
    submissionId,
    hidden: c.hidden,
    archived: c.archived ?? false,
    featured: c.featured,
    pinned: c.pinned,
    eventStatus: canonicalEvent?.status ?? null,
  };
}

function groupRow(g: GroupModRecord): AdminContentRow {
  const submissionId = g.id.startsWith("user-") ? g.id.slice("user-".length) : null;
  return {
    id: g.id,
    kind: "group",
    refId: g.id,
    cityId: g.cityId,
    title: g.name,
    authorLabel: null,
    source: submissionId ? "submission" : "seed",
    submissionId,
    hidden: (g.status ?? "published") !== "published",
    archived: g.archived ?? false,
    featured: false,
    pinned: false,
    eventStatus: null,
  };
}

/**
 * Admin listing of ALL content for a city (optionally one kind). Routine
 * read: audited with the server-generated routine reason — no operator prompt.
 * Never returns emails/phones/IPs; only registry facts + public titles.
 * City Admins are forced to their own city scope server-side.
 */
export function listAdminContent(
  db: Db,
  ctx: AdminCtx,
  opts: { cityId?: string | null; kind?: AdminContentKind | null },
  now = new Date(),
): AdminResult<AdminContentRow[]> {
  const auth = authorizeScoped(db, routineAdminCtx(ctx), "admin.content_list", null, now, { enforceCity: opts.cityId ?? null, auditCity: opts.cityId ?? null });
  if (!auth.ok) return auth;
  // City Admin callers are always pinned to their assigned city — a null
  // (global) request or a foreign city never escapes the scope.
  const cityId = auth.data.scope.kind === "city" ? auth.data.scope.cityId : opts.cityId ?? null;
  const rows: AdminContentRow[] = [];
  for (const c of db.listContent()) {
    if (cityId && c.cityId !== cityId) continue;
    if (opts.kind && c.kind !== opts.kind) continue;
    rows.push(contentRow(c, db));
  }
  for (const g of db.listGroups()) {
    if (cityId && g.cityId !== cityId) continue;
    if (opts.kind && opts.kind !== "group") continue;
    rows.push(groupRow(g));
  }
  rows.sort((a, b) => a.title.localeCompare(b.title));
  return { ok: true, data: rows };
}

// ------------------------------------------------------------- resolution

type ContentTarget =
  | { kind: "content"; rec: ContentRecord }
  | { kind: "group"; rec: GroupModRecord };

function resolveTarget(db: Db, id: string): ContentTarget | null {
  const content = db.getContent(id);
  if (content) return { kind: "content", rec: content };
  const group = db.getGroup(id);
  if (group) return { kind: "group", rec: group };
  return null;
}

function requireTitle(title: unknown): AdminResult<string> {
  const t = typeof title === "string" ? title.trim() : "";
  if (!t || t.length > CONTENT_TITLE_MAX) {
    return { ok: false, status: 400, error: "invalid_title", message: `Title must be 1–${CONTENT_TITLE_MAX} characters.` };
  }
  return { ok: true, data: t };
}

/** Submission source record behind a community-submitted content row. */
function sourceSubmission(db: Db, refId: string): SubmissionRecord | null {
  if (!refId.startsWith("user-")) return null;
  return db.getSubmission(refId.slice("user-".length)) ?? null;
}

/** Canonical event records that a registry event row controls (by id or seedRefId). */
function canonicalEventsFor(db: Db, content: ContentRecord): ReturnType<Db["listEvents"]> {
  if (content.kind !== "event") return [];
  return db.listEvents().filter((e) => e.id === content.id || e.seedRefId === content.refId);
}

/** Owner identity of a content target for the audit trail (account email or seed label). */
function contentOwner(db: Db, target: ContentTarget): string | null {
  if (target.kind === "group") {
    const owner = target.rec.ownerId ? db.getAccount(target.rec.ownerId) : undefined;
    return owner?.email ?? target.rec.ownerId ?? null;
  }
  if (target.rec.authorAccountId) {
    const owner = db.getAccount(target.rec.authorAccountId);
    if (owner) return owner.email;
  }
  if (target.rec.authorLabel) return `${target.rec.authorLabel} (seeded)`;
  const sub = sourceSubmission(db, target.rec.refId);
  if (sub) {
    const submitter = db.getAccount(sub.submitterAccountId);
    return submitter?.email ?? null;
  }
  return null;
}

/** Display title of a content target (ContentRecord.title / GroupModRecord.name). */
function targetTitle(target: ContentTarget): string {
  return target.kind === "group" ? target.rec.name : target.rec.title;
}

// ------------------------------------------------------------------- edit

/**
 * Super-admin retitle of a race / run / group / forum post.
 *
 * For community-submitted records the new title propagates to the source
 * submission payload (and the canonical event / group record) so the public
 * listing shows the corrected title. Seeded preview records keep their client
 * seed title for public rendering (the client renders seed data); the registry
 * title — which drives every admin surface — is updated here, and seeded
 * content that supports server rendering (canonical events) is updated too.
 * Audited, reason-required, Global Admin only.
 */
export function editContentTitle(
  db: Db,
  ctx: AdminCtx,
  id: string,
  title: unknown,
  now = new Date(),
): AdminResult<AdminContentRow> {
  const target = resolveTarget(db, id);
  if (!target) return { ok: false, status: 404, error: "not_found" };
  const auth = authorizeScoped(
    db,
    ctx,
    "admin.content_edit",
    id,
    now,
    { enforceCity: target.rec.cityId, auditCity: target.rec.cityId, owner: contentOwner(db, target), change: `title: "${targetTitle(target)}" -> "${String(title ?? "").trim().slice(0, CONTENT_TITLE_MAX)}"` },
  );
  if (!auth.ok) return auth;
  const t = requireTitle(title);
  if (!t.ok) return t;
  const trimmed = t.data.slice(0, CONTENT_TITLE_MAX);

  if (target.kind === "group") {
    const rec = target.rec;
    db.updateGroup(rec.id, { name: trimmed });
    const sub = sourceSubmission(db, rec.id);
    if (sub && sub.kind === "group" && sub.payload.kind === "group") {
      db.updateSubmission(sub.id, { payload: { ...sub.payload, name: trimmed } });
    }
    return { ok: true, data: groupRow(db.getGroup(rec.id)!) };
  }

  const rec = target.rec;
  const updated = db.upsertContent({ ...rec, title: trimmed });
  const sub = sourceSubmission(db, rec.refId);
  if (sub) {
    if (sub.kind === "race" && sub.payload.kind === "race") {
      db.updateSubmission(sub.id, { payload: { ...sub.payload, name: trimmed } });
    } else if (sub.kind === "event" && sub.payload.kind === "event") {
      db.updateSubmission(sub.id, { payload: { ...sub.payload, title: trimmed } });
    }
    // Canonical event title follows the corrected submission title.
    for (const e of db.listEvents().filter((ev) => ev.id === updated.id)) {
      db.setEvent({ ...e, title: trimmed, updatedAt: now.toISOString(), updatedBy: auth.data.accountId ?? auth.data.admin });
    }
  } else if (rec.kind === "event") {
    for (const e of canonicalEventsFor(db, rec)) {
      db.setEvent({ ...e, title: trimmed, updatedAt: now.toISOString(), updatedBy: auth.data.accountId ?? auth.data.admin });
    }
  }
  return { ok: true, data: contentRow(db.getContent(updated.id) ?? updated, db) };
}

// ------------------------------------------------------------------- hide

/**
 * Super-admin hide: removes a race / run / group / forum post from public
 * rendering. Restorable via restoreContent. Events sync their canonical
 * RunEventRecord (hidden=true, status "hidden"); groups flip to status
 * "suspended" (the existing public directory "not published" state). Audited,
 * reason-required, Global Admin only.
 */
export function hideContent(db: Db, ctx: AdminCtx, id: string, now = new Date()): AdminResult<AdminContentRow> {
  const target = resolveTarget(db, id);
  if (!target) return { ok: false, status: 404, error: "not_found" };
  const auth = authorizeScoped(db, ctx, "admin.content_hide", id, now, { enforceCity: target.rec.cityId, auditCity: target.rec.cityId, owner: contentOwner(db, target), change: `hidden (public rendering removed)` });
  if (!auth.ok) return auth;
  if (target.kind === "group") {
    const rec = target.rec;
    if ((rec.status ?? "published") !== "published") return { ok: false, status: 409, error: "already_hidden" };
    if (rec.archived) return { ok: false, status: 409, error: "already_archived" };
    db.updateGroup(rec.id, { status: "suspended" });
    return { ok: true, data: groupRow(db.getGroup(rec.id)!) };
  }
  const rec = target.rec;
  if (rec.hidden) return { ok: false, status: 409, error: "already_hidden" };
  if (rec.archived) return { ok: false, status: 409, error: "already_archived" };
  db.upsertContent({ ...rec, hidden: true, hiddenAt: now.toISOString() });
  for (const e of canonicalEventsFor(db, rec)) {
    db.setEvent({ ...e, hidden: true, status: "hidden", updatedAt: now.toISOString(), updatedBy: auth.data.accountId ?? auth.data.admin });
  }
  return { ok: true, data: contentRow(db.getContent(rec.id)!, db) };
}

// ---------------------------------------------------------------- restore

/**
 * Super-admin restore (reverse a hide): a hidden race / run / group / forum
 * post becomes publicly visible again. Events sync their canonical record back
 * to "published"; groups flip back to "published". Archived records cannot be
 * restored. Audited, reason-required, Global Admin only.
 */
export function restoreContent(db: Db, ctx: AdminCtx, id: string, now = new Date()): AdminResult<AdminContentRow> {
  const target = resolveTarget(db, id);
  if (!target) return { ok: false, status: 404, error: "not_found" };
  const auth = authorizeScoped(db, ctx, "admin.content_unhide", id, now, { enforceCity: target.rec.cityId, auditCity: target.rec.cityId, owner: contentOwner(db, target), change: `restored to public rendering` });
  if (!auth.ok) return auth;
  if (target.kind === "group") {
    const rec = target.rec;
    if (rec.archived) return { ok: false, status: 409, error: "already_archived" };
    if ((rec.status ?? "published") === "published") return { ok: false, status: 409, error: "not_hidden" };
    db.updateGroup(rec.id, { status: "published" });
    return { ok: true, data: groupRow(db.getGroup(rec.id)!) };
  }
  const rec = target.rec;
  if (rec.archived) return { ok: false, status: 409, error: "already_archived" };
  if (!rec.hidden) return { ok: false, status: 409, error: "not_hidden" };
  db.upsertContent({ ...rec, hidden: false, hiddenAt: null });
  for (const e of canonicalEventsFor(db, rec)) {
    db.setEvent({ ...e, hidden: false, status: "published", updatedAt: now.toISOString(), updatedBy: auth.data.accountId ?? auth.data.admin });
  }
  return { ok: true, data: contentRow(db.getContent(rec.id)!, db) };
}

// ---------------------------------------------------------------- archive

/**
 * Admin archive/remove: terminal removal of a race / run / group / forum
 * post from public rendering. Unlike hide there is no restore path — the
 * record and its audit trail are kept, but the item stays out of the public
 * surface. Events sync their canonical record to "archived"; groups set the
 * archived flag (the public directory excludes them). Audited, reason-required.
 * `deleteContent` is the full soft-delete (archive + dependent-content
 * cascade); this function is the registry-level archive used by the existing
 * "Archive" action and by `deleteContent` itself.
 */
export function archiveContent(db: Db, ctx: AdminCtx, id: string, now = new Date()): AdminResult<AdminContentRow> {
  const target = resolveTarget(db, id);
  if (!target) return { ok: false, status: 404, error: "not_found" };
  const auth = authorizeScoped(db, ctx, "admin.content_archive", id, now, { enforceCity: target.rec.cityId, auditCity: target.rec.cityId, owner: contentOwner(db, target), change: "archived (removed from public rendering; no restore path)" });
  if (!auth.ok) return auth;
  if (target.kind === "group") {
    const rec = target.rec;
    if (rec.archived) return { ok: false, status: 409, error: "already_archived" };
    db.updateGroup(rec.id, { archived: true, archivedAt: now.toISOString() });
    return { ok: true, data: groupRow(db.getGroup(rec.id)!) };
  }
  const rec = target.rec;
  if (rec.archived) return { ok: false, status: 409, error: "already_archived" };
  db.upsertContent({ ...rec, archived: true, archivedAt: now.toISOString() });
  for (const e of canonicalEventsFor(db, rec)) {
    db.setEvent({ ...e, status: "archived", archivedAt: now.toISOString(), updatedAt: now.toISOString(), updatedBy: auth.data.accountId ?? auth.data.admin });
  }
  return { ok: true, data: contentRow(db.getContent(rec.id)!, db) };
}

// ------------------------------------------------------------------ delete
// Soft-delete (default archival) of content + its dependents. Nothing is
// ever hard-deleted: RSVPs/attendance, run-day discussions, ratings, and
// group memberships are stamped soft-deleted/revoked so the audit trail and
// raw rows survive, while every active listing and eligibility check stops
// showing them.

/**
 * Admin soft-delete of a race / run / group / forum post. Terminal like
 * archive (no restore), and additionally cascades to dependent content:
 *  - event: attendance rows (RSVPs + host) get `deletedAt`, run-day
 *    discussions flip to state "deleted", ratings for the event get
 *    `deletedAt`, and concerns referencing the event are resolved;
 *  - group: memberships are revoked (status "revoked");
 *  - race / post: no dependent rows exist.
 * Audited with actor/action/target/owner/change/time; reason-required;
 * Global Admin any city, City Admin within their assigned city only.
 */
export function deleteContent(db: Db, ctx: AdminCtx, id: string, now = new Date()): AdminResult<AdminContentRow> {
  const target = resolveTarget(db, id);
  if (!target) return { ok: false, status: 404, error: "not_found" };
  const eventIds = target.kind === "content" && target.rec.kind === "event" ? canonicalEventsFor(db, target.rec).map((e) => e.id) : [];
  const change = describeDeleteCascade(db, target, eventIds);
  const auth = authorizeScoped(db, ctx, "admin.content_delete", id, now, { enforceCity: target.rec.cityId, auditCity: target.rec.cityId, owner: contentOwner(db, target), change });
  if (!auth.ok) return auth;

  if (target.kind === "group") {
    const rec = target.rec;
    if (rec.archived) return { ok: false, status: 409, error: "already_archived" };
    db.updateGroup(rec.id, { archived: true, archivedAt: now.toISOString() });
    let revoked = 0;
    for (const m of db.listMemberships()) {
      if (m.groupId === rec.id && (m.status === "active" || m.status === "pending")) {
        db.updateMembership(m.id, { status: "revoked", updatedAt: now.toISOString(), decidedBy: auth.data.admin });
        revoked++;
      }
    }
    // Delete the source submission too (kept as a decided record — the
    // submission itself is never removed so the submitter's history survives).
    const sub = sourceSubmission(db, rec.id);
    if (sub && sub.status === "approved") db.updateSubmission(sub.id, { status: "rejected", rejectionReason: "Content removed by an admin", decidedAt: now.toISOString(), decidedBy: auth.data.admin });
    return { ok: true, data: groupRow(db.getGroup(rec.id)!) };
  }

  const rec = target.rec;
  if (rec.archived) return { ok: false, status: 409, error: "already_archived" };
  db.upsertContent({ ...rec, archived: true, archivedAt: now.toISOString() });

  // Cascade dependents of canonical event rows.
  for (const eventId of eventIds) {
    const at = now.toISOString();
    for (const a of db.listAllAttendanceByEvent(eventId)) db.updateAttendance(a.id, { deletedAt: at });
    for (const d of db.listDiscussionsByEvent(eventId)) if (d.state !== "deleted") db.updateDiscussion(d.id, { state: "deleted", body: "", title: null });
    for (const r of db.listAllRatings()) if (r.eventId === eventId && !r.deletedAt) db.updateRating(r.id, { deletedAt: at });
    for (const c of db.listConcerns()) if (c.eventId === eventId && c.status === "open") db.updateConcern(c.id, { status: "resolved" });
    const canonical = db.getEvent(eventId);
    if (canonical) db.setEvent({ ...canonical, status: "archived", archivedAt: at, updatedAt: at, updatedBy: auth.data.accountId ?? auth.data.admin });
  }
  const sub = sourceSubmission(db, rec.refId);
  if (sub && sub.status === "approved") db.updateSubmission(sub.id, { status: "rejected", rejectionReason: "Content removed by an admin", decidedAt: now.toISOString(), decidedBy: auth.data.admin });
  return { ok: true, data: contentRow(db.getContent(rec.id)!, db) };
}

/** Snapshot summary of the cascade for the audit entry (computed pre-mutation). */
function describeDeleteCascade(db: Db, target: ContentTarget, eventIds: string[]): string {
  if (target.kind === "group") {
    const memberships = db.listMemberships().filter((m) => m.groupId === target.rec.id && (m.status === "active" || m.status === "pending")).length;
    return `deleted (soft): archived group; ${memberships} membership(s) revoked`;
  }
  const sub = sourceSubmission(db, target.rec.refId);
  const parts: string[] = ["deleted (soft): removed from public rendering"];
  if (target.rec.kind === "event") {
    const attendance = db.listAllAttendanceByEvent(target.rec.id).length;
    const discussions = db.listDiscussionsByEvent(target.rec.id).filter((d) => d.state !== "deleted").length;
    const ratings = db.listAllRatings().filter((r) => r.eventId === target.rec.id && !r.deletedAt).length;
    const concerns = db.listConcerns().filter((c) => c.eventId === target.rec.id && c.status === "open").length;
    if (eventIds.length > 1) {
      const attendanceAll = eventIds.reduce((n, e) => n + db.listAllAttendanceByEvent(e).length, 0);
      const discussionsAll = eventIds.reduce((n, e) => n + db.listDiscussionsByEvent(e).filter((d) => d.state !== "deleted").length, 0);
      parts.push(`soft-deleted ${attendanceAll} RSVP/attendance row(s), ${discussionsAll} discussion(s), ratings, concerns`);
    } else {
      parts.push(`soft-deleted ${attendance} RSVP/attendance row(s), ${discussions} discussion(s), ${ratings} rating(s), ${concerns} concern(s)`);
    }
  }
  if (sub) parts.push(`source submission ${sub.id} marked rejected`);
  return parts.join("; ");
}

// ------------------------------------------------------------- discussions
// Run-day occurrence discussions (threads + comments) are the only
// server-side comment records in the product. Admins may edit the body
// (moderation: remove bad text while keeping the thread) and delete the
// record (soft — state "deleted", body/title blanked, row preserved).

export interface AdminDiscussionRow {
  id: string;
  kind: "thread" | "comment";
  parentId: string | null;
  occurrenceId: string;
  eventId: string;
  cityId: string;
  title: string | null;
  body: string;
  authorLabel: string | null;
  authorEmail: string | null;
  createdAt: string;
  updatedAt: string;
}

function discussionRow(db: Db, d: DiscussionRecord): AdminDiscussionRow {
  const author = d.authorId ? db.getAccount(d.authorId) : undefined;
  return {
    id: d.id,
    kind: d.kind,
    parentId: d.parentId,
    occurrenceId: d.occurrenceId,
    eventId: d.eventId,
    cityId: d.cityId,
    title: d.title,
    body: d.body,
    authorLabel: author ? author.name : null,
    authorEmail: author?.email ?? null,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  };
}

/**
 * Admin listing of active discussions (routine read, city-scoped for City
 * Admins — same enforcement as content rows).
 */
export function listAdminDiscussions(
  db: Db,
  ctx: AdminCtx,
  opts: { cityId?: string | null },
  now = new Date(),
): AdminResult<AdminDiscussionRow[]> {
  const auth = authorizeScoped(db, routineAdminCtx(ctx), "admin.discussion_list", null, now, { enforceCity: opts.cityId ?? null, auditCity: opts.cityId ?? null });
  if (!auth.ok) return auth;
  const cityId = auth.data.scope.kind === "city" ? auth.data.scope.cityId : opts.cityId ?? null;
  const rows = db.listActiveDiscussions(undefined, cityId ?? undefined).map((d) => discussionRow(db, d));
  return { ok: true, data: rows };
}

/** Admin edit of a discussion body (and thread title). Soft, audited. */
export function editDiscussion(
  db: Db,
  ctx: AdminCtx,
  id: string,
  patch: { body?: unknown; title?: unknown },
  now = new Date(),
): AdminResult<AdminDiscussionRow> {
  const d = db.getDiscussion(id);
  if (!d || d.state === "deleted") return { ok: false, status: 404, error: "not_found" };
  const body = typeof patch.body === "string" ? patch.body.trim() : d.body;
  const title = patch.title === undefined || patch.title === null ? d.title : typeof patch.title === "string" ? patch.title.trim() : d.title;
  if (!body || body.length > 1000 || (title !== null && (!title || title.length > 120))) {
    return { ok: false, status: 400, error: "invalid_discussion", message: "Body (1-1000 chars) is required; thread titles are 1-120 chars." };
  }
  const owner = d.authorId ? db.getAccount(d.authorId)?.email ?? null : null;
  const change = body !== d.body ? "body edited by admin" : "title edited by admin";
  const auth = authorizeScoped(db, ctx, "admin.discussion_edit", id, now, { enforceCity: d.cityId, auditCity: d.cityId, owner, change });
  if (!auth.ok) return auth;
  const updated = db.updateDiscussion(id, { body, title })!;
  return { ok: true, data: discussionRow(db, updated) };
}

/** Admin delete of a discussion (soft — state "deleted", row preserved). */
export function deleteDiscussion(
  db: Db,
  ctx: AdminCtx,
  id: string,
  now = new Date(),
): AdminResult<{ deleted: true }> {
  const d = db.getDiscussion(id);
  if (!d || d.state === "deleted") return { ok: false, status: 404, error: "not_found" };
  const owner = d.authorId ? db.getAccount(d.authorId)?.email ?? null : null;
  const auth = authorizeScoped(db, ctx, "admin.discussion_delete", id, now, { enforceCity: d.cityId, auditCity: d.cityId, owner, change: `deleted (soft): "${d.body.slice(0, 80)}${d.body.length > 80 ? "…" : ""}"` });
  if (!auth.ok) return auth;
  db.updateDiscussion(id, { state: "deleted", body: "", title: null });
  // Cascade: soft-delete child comments of a deleted thread.
  if (d.kind === "thread") {
    for (const child of db.listActiveDiscussions()) {
      if (child.parentId === d.id) db.updateDiscussion(child.id, { state: "deleted", body: "", title: null });
    }
  }
  return { ok: true, data: { deleted: true } };
}

// ------------------------------------------------------------ announcement
// The announcement is a SITE-WIDE setting (SiteSettings.announcement). The
// data model has no per-city announcement, so these overrides are Global
// Admin only; City Admins cannot manage the site announcement (documented
// limitation, enforced server-side).

export interface AnnouncementResult {
  announcement: { text: string; link?: string } | null;
}

/** Global Admin sets the site announcement (audited with actor/change/time). */
export function setAnnouncement(
  db: Db,
  ctx: AdminCtx,
  input: { text?: unknown; link?: unknown },
  now = new Date(),
): AdminResult<AnnouncementResult> {
  const text = typeof input.text === "string" ? input.text.trim() : "";
  if (!text || text.length > 300) return { ok: false, status: 400, error: "invalid_announcement", message: "Announcement text is required (1-300 chars)." };
  let link: string | undefined;
  if (input.link !== undefined && input.link !== null && String(input.link).trim() !== "") {
    const raw = String(input.link).trim();
    if (!/^https?:\/\//.test(raw) || raw.length > 500) return { ok: false, status: 400, error: "invalid_url", message: "Announcement link must be a valid http(s) URL (max 500 chars)." };
    link = raw;
  }
  const settings = db.getSettings(DEFAULT_SETTINGS);
  const prev = settings.announcement?.text ?? null;
  const auth = authorizeScoped(db, ctx, "admin.announcement_edit", null, now, { globalOnly: true, owner: null, change: `announcement: ${prev === null ? "(none)" : `"${prev.slice(0, 60)}${prev.length > 60 ? "…" : ""}"`} -> "${text.slice(0, 60)}${text.length > 60 ? "…" : ""}"` });
  if (!auth.ok) return auth;
  db.setSettings({ ...settings, announcement: { text, ...(link ? { link } : {}) } });
  return { ok: true, data: { announcement: db.getSettings(DEFAULT_SETTINGS).announcement } };
}

/** Global Admin clears the site announcement (audited). */
export function clearAnnouncement(db: Db, ctx: AdminCtx, now = new Date()): AdminResult<AnnouncementResult> {
  const settings = db.getSettings(DEFAULT_SETTINGS);
  if (!settings.announcement) return { ok: false, status: 409, error: "no_announcement" };
  const prev = settings.announcement;
  const auth = authorizeScoped(db, ctx, "admin.announcement_remove", null, now, { globalOnly: true, owner: null, change: `announcement cleared (was: "${prev.text.slice(0, 60)}${prev.text.length > 60 ? "…" : ""}")` });
  if (!auth.ok) return auth;
  db.setSettings({ ...settings, announcement: null });
  return { ok: true, data: { announcement: null } };
}

/** Slice a reason to the audit limit (shared by api.ts callers). */
export function auditReason(reason: string | undefined): string {
  return (reason ?? "").trim().slice(0, REASON_MAX);
}
