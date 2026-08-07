/**
 * Super-admin (global) read/write content management.
 *
 * This is the owner + key-admin surface for managing ALL published content —
 * community-submitted races / independent runs / groups, seeded preview races /
 * events / forum posts, and the moderation registry behind them:
 *
 *  - list:       routine read of every content row (per city / kind), no
 *                operator-entered reason required (audited as a routine read);
 *  - edit:       retitle a race / run / group / forum post; for
 *                community-submitted records the edit propagates to the source
 *                submission payload (and canonical event / group record) so the
 *                PUBLIC listing reflects it;
 *  - hide:       remove from public rendering (restorable);
 *  - restore:    reverse a hide (the "unhide" path);
 *  - archive:    terminal removal from public rendering (kept for audit).
 *
 * Authorization model (matches dashboard.ts): every handler uses
 * `authorizeScoped(..., { globalOnly: true })` — Global Admin sessions ONLY
 * (owner signed-in session OR key-based admin). City Admins, Group Leaders,
 * and Verified Runners are denied server-side regardless of client payloads.
 * Every mutation is reason-required (5–500 chars) and audited; routine reads
 * use `routineAdminCtx` so the operator is not prompted for a reason when
 * merely listing content.
 *
 * Public-effect notes:
 *  - Races & forum posts render from the client seed + `/api/moderated`
 *    visibility facts, so hide/restore/archive update `publicModerated`
 *    (archived ids are included in the public "hidden" list) and any
 *    community-submitted payload edits flow through `/api/content`.
 *  - Canonical events (`RunEventRecord`) are the server source of truth for
 *    `/api/events`; hide/restore/archive sync the canonical record (by id or
 *    seedRefId) so `publicEvents` reflects the decision.
 *  - Groups render from `/api/groups` (`publicGroups`), which filters
 *    `status !== "published"` and `archived` — hide sets status "suspended"
 *    and archive sets `archived`, both of which the public directory honors.
 */
import type { AdminCtx, AdminResult } from "./admin";
import { authorizeScoped, routineAdminCtx } from "./admin";
import { REASON_MAX } from "./admin";
import type { Db } from "./store";
import type { ContentKind, ContentRecord, GroupModRecord, SubmissionRecord } from "./types";

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
 * Super-admin listing of ALL content for a city (optionally one kind). Routine
 * read: audited with the server-generated routine reason — no operator prompt.
 * Never returns emails/phones/IPs; only registry facts + public titles.
 */
export function listAdminContent(
  db: Db,
  ctx: AdminCtx,
  opts: { cityId?: string | null; kind?: AdminContentKind | null },
  now = new Date(),
): AdminResult<AdminContentRow[]> {
  const auth = authorizeScoped(db, routineAdminCtx(ctx), "admin.content_list", null, now, { globalOnly: true, auditCity: opts.cityId ?? null });
  if (!auth.ok) return auth;
  const rows: AdminContentRow[] = [];
  for (const c of db.listContent()) {
    if (opts.cityId && c.cityId !== opts.cityId) continue;
    if (opts.kind && c.kind !== opts.kind) continue;
    rows.push(contentRow(c, db));
  }
  for (const g of db.listGroups()) {
    if (opts.cityId && g.cityId !== opts.cityId) continue;
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
    { globalOnly: true, auditCity: target.rec.cityId },
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
  const auth = authorizeScoped(db, ctx, "admin.content_hide", id, now, { globalOnly: true, auditCity: target.rec.cityId });
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
  const auth = authorizeScoped(db, ctx, "admin.content_unhide", id, now, { globalOnly: true, auditCity: target.rec.cityId });
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
 * Super-admin archive/remove: terminal removal of a race / run / group / forum
 * post from public rendering. Unlike hide there is no restore path — the
 * record and its audit trail are kept, but the item stays out of the public
 * surface. Events sync their canonical record to "archived"; groups set the
 * archived flag (the public directory excludes them). Audited, reason-required,
 * Global Admin only.
 */
export function archiveContent(db: Db, ctx: AdminCtx, id: string, now = new Date()): AdminResult<AdminContentRow> {
  const target = resolveTarget(db, id);
  if (!target) return { ok: false, status: 404, error: "not_found" };
  const auth = authorizeScoped(db, ctx, "admin.content_archive", id, now, { globalOnly: true, auditCity: target.rec.cityId });
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

/** Slice a reason to the audit limit (shared by api.ts callers). */
export function auditReason(reason: string | undefined): string {
  return (reason ?? "").trim().slice(0, REASON_MAX);
}
