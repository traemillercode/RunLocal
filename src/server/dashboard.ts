/**
 * Dashboard handlers: flagged-content moderation (dismiss / hide / unhide),
 * posting-blocking suspensions (with optional expiry), RRCA badge notes, and
 * featured/pinned toggles for events & races — plus the public-safe moderated
 * state view the client renders against.
 *
 * Security model (mirrors admin.ts):
 *  - Global dashboard and suspension controls use `authorizeScoped` with
 *    `globalOnly`, allowing only Global Admin sessions (key or owner).
 *    City Admins and runners are rejected server-side.
 *  - City Admin moderation handlers remain explicitly city-scoped.
 *  - A reason (5–500 chars) is required for every action and every access is
 *    appended to the audit log (admin/timestamp/reason/action/target).
 *  - Dashboard payloads are redacted: content titles + author labels only.
 *    No phone, selfie reference, IP, birthdate, or Supabase identity ever
 *    appears here — those stay behind the separate admin verification-record
 *    flow (admin.ts / adminGetRecord), which remains admin-accessible.
 */
import type { AdminCtx, AdminResult } from "./admin";
import { authorizeOwner, authorizeScoped } from "./admin";
import { REASON_MAX } from "./admin";
import type { Db } from "./store";
import { isSuspended } from "./store";
import type { AccountRecord, ContentKind, ContentRecord, FlagRecord, GroupModRecord } from "./types";

// ------------------------------------------------------------------- views

export interface FlagView {
  id: string;
  cityId: string;
  contentId: string;
  kind: ContentKind;
  refId: string;
  title: string;
  reason: string;
  reporterName: string;
  createdAt: string;
  status: FlagRecord["status"];
  resolvedAt: string | null;
  resolvedAction: "dismiss" | "hide" | null;
  /** Populated when the flagged content is linked to a real account. */
  authorAccountId: string | null;
}

export interface ContentView {
  id: string;
  refId: string;
  kind: ContentKind;
  title: string;
  featured: boolean;
  pinned: boolean;
  hidden: boolean;
}

export interface GroupView {
  id: string;
  name: string;
  rrcaBadge: boolean;
  rrcaNote: string | null;
  rrcaNoteUpdatedAt: string | null;
}

export interface SuspensionView {
  accountId: string;
  name: string;
  email: string;
  status: AccountRecord["status"];
  phase: AccountRecord["phase"] | null;
  role: AccountRecord["role"];
  /** null = indefinite. Never shown publicly. */
  suspendedUntil: string | null;
  suspensionReason: string | null;
}

export interface DashboardView {
  cityId: string;
  flags: FlagView[];
  events: ContentView[];
  races: ContentView[];
  posts: ContentView[];
  groups: GroupView[];
  suspensions: SuspensionView[];
}

function flagView(f: FlagRecord, db: Db): FlagView {
  const content = db.getContent(f.contentId);
  return {
    id: f.id,
    cityId: f.cityId,
    contentId: f.contentId,
    kind: f.kind,
    refId: f.refId,
    title: f.title,
    reason: f.reason,
    reporterName: f.reporterName,
    createdAt: f.createdAt,
    status: f.status,
    resolvedAt: f.resolvedAt,
    resolvedAction: f.resolvedAction,
    authorAccountId: content?.authorAccountId ?? null,
  };
}

function contentView(c: ContentRecord): ContentView {
  return {
    id: c.id,
    refId: c.refId,
    kind: c.kind,
    title: c.title,
    featured: c.featured,
    pinned: c.pinned,
    hidden: c.hidden,
  };
}

function groupView(g: GroupModRecord): GroupView {
  return {
    id: g.id,
    name: g.name,
    rrcaBadge: g.rrcaBadge,
    rrcaNote: g.rrcaNote,
    rrcaNoteUpdatedAt: g.rrcaNoteUpdatedAt,
  };
}

function suspensionView(rec: AccountRecord): SuspensionView {
  return {
    accountId: rec.id,
    name: rec.name,
    email: rec.email,
    status: rec.status,
    phase: rec.status === "pending" ? rec.phase : null,
    role: rec.role,
    suspendedUntil: rec.suspendedUntil,
    suspensionReason: rec.suspensionReason,
  };
}

// ------------------------------------------------------------- overview

/**
 * Owner-only dashboard overview for one city. All rows are redacted — no
 * phone/selfie/IP — and the access itself is reason-required + audited.
 */
export function dashboardOverview(
  db: Db,
  ctx: AdminCtx,
  cityId: string,
  now = new Date(),
): AdminResult<DashboardView> {
  const auth = authorizeScoped(db, ctx, "admin.dashboard", null, now, { globalOnly: true, auditCity: cityId });
  if (!auth.ok) return auth;
  return dashboardRows(db, cityId, now, { suspensions: true });
}

/**
 * City Admin dashboard overview — scope is enforced server-side (the client
 * cannot pass another city), and suspensions are ALWAYS empty: suspension
 * management is Global Admin-only.
 */
export function cityDashboardOverview(db: Db, ctx: AdminCtx, now = new Date()): AdminResult<DashboardView> {
  const auth = authorizeScoped(db, ctx, "cityadmin.dashboard", null, now);
  if (!auth.ok) return auth;
  const cityId = auth.data.scope.kind === "city" ? auth.data.scope.cityId : null;
  if (cityId === null) return { ok: false, status: 403, error: "city_scope_denied" };
  const view = dashboardRows(db, cityId, now, { suspensions: false });
  if (!view.ok) return view;
  return { ok: true, data: { ...view.data, cityId } };
}

function dashboardRows(
  db: Db,
  cityId: string,
  now: Date,
  opts: { suspensions: boolean },
): AdminResult<DashboardView> {
  const flags = db
    .listFlags()
    .filter((f) => f.cityId === cityId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((f) => flagView(f, db));
  const events = db
    .listContent()
    .filter((c) => c.cityId === cityId && c.kind === "event")
    .map(contentView)
    .sort((a, b) => a.refId.localeCompare(b.refId));
  const races = db
    .listContent()
    .filter((c) => c.cityId === cityId && c.kind === "race")
    .map(contentView)
    .sort((a, b) => a.refId.localeCompare(b.refId));
  const posts = db
    .listContent()
    .filter((c) => c.cityId === cityId && c.kind === "post")
    .map(contentView)
    .sort((a, b) => a.refId.localeCompare(b.refId));
  const groups = db
    .listGroups()
    .filter((g) => g.cityId === cityId)
    .map(groupView)
    .sort((a, b) => a.name.localeCompare(b.name));
  const suspensions = opts.suspensions
    ? db
        .listAccounts()
        .filter((a) => !a.deletedAt && isSuspended(a, now))
        .map(suspensionView)
        .sort((a, b) => a.name.localeCompare(b.name))
    : [];
  return { ok: true, data: { cityId, flags, events, races, posts, groups, suspensions } };
}

// ------------------------------------------------------------ moderation

/**
 * Owner-only moderation of an OPEN flag: dismiss (content stays visible) or
 * hide (content hidden from public rendering). Reason required + audited.
 */
export function moderateFlag(
  db: Db,
  ctx: AdminCtx,
  flagId: string,
  action: "dismiss" | "hide",
  now = new Date(),
): AdminResult<FlagView> {
  const auth = authorizeOwner(db, ctx, action === "dismiss" ? "admin.flag_dismiss" : "admin.flag_hide", flagId, now);
  if (!auth.ok) return auth;
  return moderateFlagCore(db, flagId, action, now);
}

/**
 * City Admin variant — the flag's city MUST equal the City Admin's scope.
 * The flag is resolved first so the authorization binds to its cityId.
 */
export function cityModerateFlag(
  db: Db,
  ctx: AdminCtx,
  flagId: string,
  action: "dismiss" | "hide",
  now = new Date(),
): AdminResult<FlagView> {
  const flag = db.getFlag(flagId);
  if (!flag) return { ok: false, status: 404, error: "not_found" };
  const auth = authorizeScoped(
    db,
    ctx,
    action === "dismiss" ? "cityadmin.flag_dismiss" : "cityadmin.flag_hide",
    flagId,
    now,
    { enforceCity: flag.cityId, auditCity: flag.cityId },
  );
  if (!auth.ok) return auth;
  return moderateFlagCore(db, flagId, action, now);
}

function moderateFlagCore(
  db: Db,
  flagId: string,
  action: "dismiss" | "hide",
  now: Date,
): AdminResult<FlagView> {
  const flag = db.getFlag(flagId);
  if (!flag) return { ok: false, status: 404, error: "not_found" };
  if (flag.status !== "open") return { ok: false, status: 409, error: "already_resolved" };
  if (action === "hide") {
    const content = db.getContent(flag.contentId);
    if (content) {
      db.upsertContent({ ...content, hidden: true, hiddenAt: now.toISOString() });
    }
  }
  const updated = db.updateFlag(flagId, {
    status: action === "dismiss" ? "dismissed" : "hidden",
    resolvedAt: now.toISOString(),
    resolvedAction: action,
  })!;
  return { ok: true, data: flagView(updated, db) };
}

/**
 * Owner-only reversal: make a hidden item visible again. Flag history is kept
 * (the flag record stays resolved) — the audit entry documents the reversal.
 */
export function unhideContent(
  db: Db,
  ctx: AdminCtx,
  contentId: string,
  now = new Date(),
): AdminResult<ContentView> {
  const auth = authorizeOwner(db, ctx, "admin.content_unhide", contentId, now);
  if (!auth.ok) return auth;
  return unhideContentCore(db, contentId);
}

/** City Admin variant — the content's city MUST equal the City Admin's scope. */
export function cityUnhideContent(
  db: Db,
  ctx: AdminCtx,
  contentId: string,
  now = new Date(),
): AdminResult<ContentView> {
  const content = db.getContent(contentId);
  if (!content) return { ok: false, status: 404, error: "not_found" };
  const auth = authorizeScoped(db, ctx, "cityadmin.content_unhide", contentId, now, { enforceCity: content.cityId, auditCity: content.cityId });
  if (!auth.ok) return auth;
  return unhideContentCore(db, contentId);
}

function unhideContentCore(db: Db, contentId: string): AdminResult<ContentView> {
  const content = db.getContent(contentId);
  if (!content) return { ok: false, status: 404, error: "not_found" };
  if (!content.hidden) return { ok: false, status: 409, error: "not_hidden" };
  const updated = db.upsertContent({ ...content, hidden: false, hiddenAt: null });
  return { ok: true, data: contentView(updated) };
}

// ------------------------------------------------------------- suspension

const MAX_SUSPENSION_DAYS = 365;

/**
 * Owner-only posting-blocking suspension. `days`:
 *  - null → indefinite (until lifted);
 *  - 1..365 → expires that many days from now.
 * The audit reason is stored as the suspension reason. Audited + reason-required.
 */
export function suspendAccount(
  db: Db,
  ctx: AdminCtx,
  accountId: string,
  days: number | null,
  now = new Date(),
): AdminResult<SuspensionView> {
  const auth = authorizeScoped(db, ctx, "admin.suspend", accountId, now, { globalOnly: true });
  if (!auth.ok) return auth;
  if (days !== null && (!Number.isInteger(days) || days < 1 || days > MAX_SUSPENSION_DAYS)) {
    return { ok: false, status: 400, error: "invalid_expiry", message: `Suspension days must be 1–${MAX_SUSPENSION_DAYS}, or blank for indefinite.` };
  }
  const rec = db.getAccount(accountId);
  if (!rec) return { ok: false, status: 404, error: "not_found" };
  if (rec.deletedAt) return { ok: false, status: 409, error: "account_deleted" };
  const until = days === null ? null : new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
  const updated = db.updateAccount(accountId, {
    suspended: true,
    suspendedUntil: until,
    suspensionReason: ctx.reason!.trim().slice(0, REASON_MAX),
    lastActivityAt: now.toISOString(),
  })!;
  return { ok: true, data: suspensionView(updated) };
}

/** Owner-only lift of a suspension. Audited + reason-required. */
export function liftSuspension(
  db: Db,
  ctx: AdminCtx,
  accountId: string,
  now = new Date(),
): AdminResult<SuspensionView> {
  const auth = authorizeScoped(db, ctx, "admin.unsuspend", accountId, now, { globalOnly: true });
  if (!auth.ok) return auth;
  const rec = db.getAccount(accountId);
  if (!rec) return { ok: false, status: 404, error: "not_found" };
  if (!rec.suspended) {
    return { ok: false, status: 409, error: "not_suspended" };
  }
  const updated = db.updateAccount(accountId, { suspended: false, suspendedUntil: null, suspensionReason: null, lastActivityAt: now.toISOString() })!;
  return { ok: true, data: suspensionView(updated) };
}

// ---------------------------------------------------------------- RRCA

/**
 * Owner-only RRCA badge + internal note for a group. The badge controls the
 * public "RRCA-Chartered Club" label; the note is owner-only evidence of why
 * the charter claim is warranted (truthfulness trail). Audited + reason-required.
 */
export function setGroupRrca(
  db: Db,
  ctx: AdminCtx,
  groupId: string,
  input: { badge: boolean; note?: string },
  now = new Date(),
): AdminResult<GroupView> {
  const auth = authorizeOwner(db, ctx, "admin.group_rrca", groupId, now);
  if (!auth.ok) return auth;
  return setGroupRrcaCore(db, groupId, input, now);
}

/** City Admin variant — the group's city MUST equal the City Admin's scope. */
export function citySetGroupRrca(
  db: Db,
  ctx: AdminCtx,
  groupId: string,
  input: { badge: boolean; note?: string },
  now = new Date(),
): AdminResult<GroupView> {
  const group = db.getGroup(groupId);
  if (!group) return { ok: false, status: 404, error: "not_found" };
  const auth = authorizeScoped(db, ctx, "cityadmin.group_rrca", groupId, now, { enforceCity: group.cityId, auditCity: group.cityId });
  if (!auth.ok) return auth;
  return setGroupRrcaCore(db, groupId, input, now);
}

function setGroupRrcaCore(
  db: Db,
  groupId: string,
  input: { badge: boolean; note?: string },
  now: Date,
): AdminResult<GroupView> {
  const group = db.getGroup(groupId);
  if (!group) return { ok: false, status: 404, error: "not_found" };
  const note = input.note === undefined ? group.rrcaNote : input.note.trim().slice(0, REASON_MAX) || null;
  const updated = db.updateGroup(groupId, {
    rrcaBadge: Boolean(input.badge),
    rrcaNote: note,
    rrcaNoteUpdatedAt: note === group.rrcaNote ? group.rrcaNoteUpdatedAt : now.toISOString(),
  })!;
  return { ok: true, data: groupView(updated) };
}

// --------------------------------------------------------------- highlight

/**
 * Owner-only featured/pinned toggles for an event or race. The two flags are
 * independent. Audited + reason-required.
 */
export function setContentHighlight(
  db: Db,
  ctx: AdminCtx,
  contentId: string,
  patch: { featured?: boolean; pinned?: boolean },
  now = new Date(),
): AdminResult<ContentView> {
  const auth = authorizeOwner(db, ctx, "admin.content_highlight", contentId, now);
  if (!auth.ok) return auth;
  return setContentHighlightCore(db, contentId, patch);
}

/** City Admin variant — the content's city MUST equal the City Admin's scope. */
export function citySetContentHighlight(
  db: Db,
  ctx: AdminCtx,
  contentId: string,
  patch: { featured?: boolean; pinned?: boolean },
  now = new Date(),
): AdminResult<ContentView> {
  const content = db.getContent(contentId);
  if (!content) return { ok: false, status: 404, error: "not_found" };
  const auth = authorizeScoped(db, ctx, "cityadmin.content_highlight", contentId, now, { enforceCity: content.cityId, auditCity: content.cityId });
  if (!auth.ok) return auth;
  return setContentHighlightCore(db, contentId, patch);
}

function setContentHighlightCore(
  db: Db,
  contentId: string,
  patch: { featured?: boolean; pinned?: boolean },
): AdminResult<ContentView> {
  const content = db.getContent(contentId);
  if (!content) return { ok: false, status: 404, error: "not_found" };
  if (content.kind === "post") {
    return { ok: false, status: 400, error: "invalid_kind", message: "Featured/pinned applies to events and races only." };
  }
  const updated = db.upsertContent({
    ...content,
    featured: patch.featured === undefined ? content.featured : Boolean(patch.featured),
    pinned: patch.pinned === undefined ? content.pinned : Boolean(patch.pinned),
  });
  return { ok: true, data: contentView(updated) };
}

// ------------------------------------------------- public (no auth) view

export interface ModeratedPublicState {
  cityId: string;
  /** Registry ids ("kind:refId") of content hidden by moderation. */
  hidden: string[];
  /**
   * Registry ids archived by a super-admin. Archived content is also included
   * in `hidden` so the public rendering excludes it — the distinction matters
   * only for admins (archive has no restore path).
   */
  archived: string[];
  /** Highlight toggles per event/race registry id. */
  highlights: { id: string; kind: ContentKind; refId: string; featured: boolean; pinned: boolean }[];
  /** RRCA badge state per group id (drives the public label). */
  groups: { id: string; rrcaBadge: boolean }[];
}

/**
 * Public-safe moderation state for one city. NO auth, and deliberately NO
 * flag reasons, reporters, suspension details, or any sensitive record — just
 * the visibility/ordering facts the client needs to render honestly.
 */
export function publicModerated(db: Db, cityId: string): ModeratedPublicState {
  const hidden: string[] = [];
  const archived: string[] = [];
  for (const c of db.listContent()) {
    if (c.cityId !== cityId) continue;
    if (c.hidden) hidden.push(c.id);
    if (c.archived) {
      archived.push(c.id);
      if (!hidden.includes(c.id)) hidden.push(c.id);
    }
  }
  const highlights = db
    .listContent()
    .filter((c) => c.cityId === cityId && (c.kind === "event" || c.kind === "race") && (c.featured || c.pinned))
    .map((c) => ({ id: c.id, kind: c.kind, refId: c.refId, featured: c.featured, pinned: c.pinned }));
  const groups = db
    .listGroups()
    .filter((g) => g.cityId === cityId)
    .map((g) => ({ id: g.id, rrcaBadge: g.rrcaBadge }));
  return { cityId, hidden, archived, highlights, groups };
}
