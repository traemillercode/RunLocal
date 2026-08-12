/**
 * Community submission flows — races, groups, and independent events.
 *
 * Submission lifecycle:
 *   submit (verified runner) → status "pending" → admin approve/reject
 *   → approved records become PUBLIC content (races/events lists, group
 *     records) and grants the submitter Group Leader role for a group;
 *   → rejected records carry a required rejection reason visible ONLY to
 *     the submitter (their own "My submissions" payload).
 *
 * Security model:
 *  - Every submitter permission is checked server-side against the stored
 *    account (verified status, suspension, role) — never client-trusted.
 *  - Every admin queue read / approve / reject goes through authorizeAdmin
 *    (owner OR key-based admin session) with a required audit reason.
 *  - The queue returns safe summaries (no emails/phones/IPs); the rejection
 *    reason and payload details are returned only to the submitter of that
 *    record or to an authorized admin.
 *  - Group RRCA claims are REQUESTS: approval never grants the RRCA badge —
 *    the badge is owner-assigned later via the dashboard (GroupModRecord),
 *    so a submitter can never self-certify as RRCA-Chartered.
 */
import { newId } from "./store";
import type { Db } from "./store";
import { isSuspended } from "./store";
import { addRolePatch } from "./accountRoles";
import type { AdminCtx, AdminResult } from "./admin";
import { authorizeAdmin, authorizeScoped, routineAdminCtx } from "./admin";
import { REASON_MAX, REASON_MIN } from "./admin";
import { cityAcceptsSubmissions, cityNotOpenError, cityStatus } from "./cms";
import { trustRestrictions } from "./trust";
import type {
  AccountRecord,
  EventSubmissionPayload,
  GroupSubmissionPayload,
  RaceSubmissionPayload,
  SubmissionKind,
  SubmissionPayload,
  SubmissionRecord,
  SubmissionStatus,
} from "./types";

export const SUBMISSION_REASON_MIN = REASON_MIN;
export const SUBMISSION_REASON_MAX = REASON_MAX;

// ------------------------------------------------------------------ limits
const TIME_RE = /^(1[0-2]|0?[1-9]):[0-5]\d\s[AP]M$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const INVITES = ["Open to all", "Members + guests", "RSVP requested"] as const;
const MAX_NAME = 80;
const MAX_TITLE = 100;
const MAX_LOCATION = 160;
const MAX_DISTANCE = 80;
const MAX_DESCRIPTION = 2000;
const MAX_URL = 500;

// ----------------------------------------------------------------- helpers
export function validSubmissionReason(reason: string | undefined): boolean {
  return Boolean(reason && reason.trim().length >= SUBMISSION_REASON_MIN && reason.trim().length <= SUBMISSION_REASON_MAX);
}

export function isValidHttpUrl(value: string): boolean {
  try {
    const u = new URL(value.trim());
    return (u.protocol === "http:" || u.protocol === "https:") && u.host.length > 0;
  } catch {
    return false;
  }
}

function validIsoDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function sliceTrim(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function optionalUrl(value: unknown): { ok: true; url: string | null } | { ok: false; error: string } {
  if (value === undefined || value === null || value === "") return { ok: true, url: null };
  if (typeof value !== "string") return { ok: false, error: "invalid_url" };
  const trimmed = value.trim();
  if (!trimmed) return { ok: true, url: null };
  if (!isValidHttpUrl(trimmed)) return { ok: false, error: "invalid_url" };
  return { ok: true, url: trimmed.slice(0, MAX_URL) };
}

/** Permission gate: the account must be a Verified Runner, not deleted, not suspended. */
export function requireVerifiedSubmitter(db: Db, accountId: string): AdminResult<AccountRecord> {
  const rec = db.getAccount(accountId);
  if (!rec || rec.deletedAt) return { ok: false, status: 401, error: "sign_in_required" };
  if (rec.status !== "verified") {
    return { ok: false, status: 403, error: "verification_required", message: "Only verified runners can submit — finish verification first." };
  }
  if (isSuspended(rec)) return { ok: false, status: 403, error: "suspended", message: "Your account is suspended and can't submit right now." };
  return { ok: true, data: rec };
}

/**
 * Resolve the submission's city: an explicit known cityId wins; otherwise the
 * submitter's home city. Never client-trusted — validated against the
 * server-authoritative city registry (store + seeded defaults). New
 * submissions are accepted only for cities that accept submissions (active /
 * invite_only); inactive and coming-soon cities retain their history but deny
 * new submissions.
 */
function resolveCity(db: Db, rec: AccountRecord, cityIdParam: unknown): AdminResult<string> {
  let cityId = typeof cityIdParam === "string" ? cityIdParam.trim() : "";
  if (!cityId) cityId = rec.cityId ?? "";
  if (!cityId) {
    return { ok: false, status: 400, error: "city_required", message: "This submission needs a city — set your home city or pass a cityId." };
  }
  const status = cityStatus(db, cityId);
  if (status === null) {
    return { ok: false, status: 400, error: "invalid_city", message: "That city isn't supported yet — pick one from the list." };
  }
  if (!cityAcceptsSubmissions(db, cityId)) {
    const e = cityNotOpenError(status);
    return { ok: false, status: 400, error: e.error, message: e.message };
  }
  return { ok: true, data: cityId };
}

function titleFor(payload: SubmissionPayload): string {
  if (payload.kind === "race") return payload.name;
  if (payload.kind === "group") return payload.name;
  return payload.title;
}

function newSubmission(
  kind: SubmissionKind,
  cityId: string,
  submitterAccountId: string,
  payload: SubmissionPayload,
  now: Date,
): SubmissionRecord {
  return {
    id: newId(),
    kind,
    cityId,
    status: "pending",
    submitterAccountId,
    submittedAt: now.toISOString(),
    decidedAt: null,
    decidedBy: null,
    rejectionReason: null,
    payload,
    publicRefId: null,
  };
}

// ------------------------------------------------------------------- race
export interface RaceSubmitInput {
  cityId?: unknown;
  name?: unknown;
  distances?: unknown;
  date?: unknown;
  location?: unknown;
  registrationUrl?: unknown;
  description?: unknown;
}

/**
 * A Verified Runner (or a race director, i.e. any verified runner) may submit
 * a one-off race: name, distances, date, location, external registration URL,
 * description. New submissions enter the pending queue.
 */
export function submitRace(db: Db, accountId: string, input: RaceSubmitInput, now = new Date()): AdminResult<SubmissionRecord> {
  const auth = requireVerifiedSubmitter(db, accountId);
  if (!auth.ok) return auth;
  const city = resolveCity(db, auth.data, input.cityId);
  if (!city.ok) return city;
  const payload = racePayloadFrom(input);
  if (!payload.ok) return payload;
  return { ok: true, data: db.appendSubmission(newSubmission("race", city.data, accountId, payload.data, now)) };
}

/** Server-side validation of a race submission payload (shared with admin edit). */
export function racePayloadFrom(input: RaceSubmitInput): AdminResult<RaceSubmissionPayload> {
  const name = sliceTrim(input.name, MAX_NAME);
  if (!name) return { ok: false, status: 400, error: "invalid_name", message: "Race name is required." };
  const distances = sliceTrim(input.distances, MAX_DISTANCE);
  if (!distances) return { ok: false, status: 400, error: "invalid_distances", message: "Add the race distances (e.g. “5K / 10K”)." };
  const date = sliceTrim(input.date, 10);
  if (!validIsoDate(date)) return { ok: false, status: 400, error: "invalid_date", message: "Race date must be a valid yyyy-mm-dd date." };
  const location = sliceTrim(input.location, MAX_LOCATION);
  if (!location) return { ok: false, status: 400, error: "invalid_location", message: "Race location is required." };
  const registrationUrl = sliceTrim(input.registrationUrl, MAX_URL);
  if (!isValidHttpUrl(registrationUrl)) {
    return { ok: false, status: 400, error: "invalid_url", message: "Registration link must be a full http(s) URL." };
  }
  const description = sliceTrim(input.description, MAX_DESCRIPTION);
  const payload: RaceSubmissionPayload = { kind: "race", name, distances, date, location, registrationUrl, description };
  return { ok: true, data: payload };
}

// ------------------------------------------------------------------ group
export interface GroupSubmitInput {
  cityId?: unknown;
  name?: unknown;
  description?: unknown;
  groupType?: unknown;
  groupmeUrl?: unknown;
  facebookUrl?: unknown;
  instagramUrl?: unknown;
  websiteUrl?: unknown;
  coverPhoto?: unknown;
  logoPhoto?: unknown;
  membershipMode?: unknown;
}

/**
 * A Verified Runner may submit a new local run group: name, description,
 * validated home city, external GroupMe/Facebook/Instagram/Website links, and
 * a group type that is EXACTLY "rrca-chartered" | "community". The RRCA
 * option is a request only — the charter claim is admin-assigned later, never
 * self-claimed. Approval creates the group record and grants the submitter
 * the Group Leader role for that group.
 */
export function submitGroup(db: Db, accountId: string, input: GroupSubmitInput, now = new Date()): AdminResult<SubmissionRecord> {
  const auth = requireVerifiedSubmitter(db, accountId);
  if (!auth.ok) return auth;
  // Under-review accounts may browse/RSVP/comment, but cannot host or post
  // club/coach content (server-enforced; see trust.ts trustRestrictions).
  const trust = trustRestrictions(auth.data);
  if (trust.coachPost || trust.hosting) {
    return {
      ok: false,
      status: 403,
      error: "under_review",
      message: "Your account is under community review — hosting and club/coach posting are paused. You can still browse, RSVP, and comment.",
    };
  }
  const city = resolveCity(db, auth.data, input.cityId);
  if (!city.ok) return city;
  const payload = groupPayloadFrom(input, city.data);
  if (!payload.ok) return payload;
  return { ok: true, data: db.appendSubmission(newSubmission("group", city.data, accountId, payload.data, now)) };
}

/** Server-side validation of a group submission payload (shared with admin edit). */
export function groupPayloadFrom(input: GroupSubmitInput, cityId: string): AdminResult<GroupSubmissionPayload> {
  const name = sliceTrim(input.name, MAX_NAME);
  if (!name) return { ok: false, status: 400, error: "invalid_name", message: "Group name is required." };
  const description = sliceTrim(input.description, MAX_DESCRIPTION);
  const groupType = input.groupType === "rrca-chartered" ? "rrca-chartered" : input.groupType === "community" ? "community" : null;
  if (!groupType) {
    return { ok: false, status: 400, error: "invalid_group_type", message: "Group type must be exactly “RRCA-Chartered Club” or “Community Run Group”." };
  }
  const groupme = optionalUrl(input.groupmeUrl);
  if (!groupme.ok) return { ok: false, status: 400, error: groupme.error };
  const facebook = optionalUrl(input.facebookUrl);
  if (!facebook.ok) return { ok: false, status: 400, error: facebook.error };
  const instagram = optionalUrl(input.instagramUrl);
  if (!instagram.ok) return { ok: false, status: 400, error: instagram.error };
  const website = optionalUrl(input.websiteUrl);
  if (!website.ok) return { ok: false, status: 400, error: website.error };
  const membershipMode = input.membershipMode === "open" || input.membershipMode === "request" ? input.membershipMode : null;
  if (!membershipMode) return { ok: false, status: 400, error: "invalid_membership_mode" };
  const coverPhotoRef = typeof input.coverPhoto === "string" && input.coverPhoto.trim() ? input.coverPhoto.trim().slice(0, 200) : null;
  const logoPhotoRef = typeof input.logoPhoto === "string" && input.logoPhoto.trim() ? input.logoPhoto.trim().slice(0, 200) : null;
  if (!coverPhotoRef || !logoPhotoRef) return { ok: false, status: 400, error: "photos_required", message: "Cover and logo photos are required." };
  const payload: GroupSubmissionPayload = {
    kind: "group",
    name,
    description,
    cityId,
    groupType,
    groupmeUrl: groupme.url,
    facebookUrl: facebook.url,
    instagramUrl: instagram.url,
    websiteUrl: website.url,
    coverPhotoRef,
    logoPhotoRef,
    membershipMode,
  };
  return { ok: true, data: payload };
}

// ------------------------------------------------------------------ event
export interface EventSubmitInput {
  cityId?: unknown;
  type?: unknown;
  title?: unknown;
  date?: unknown;
  dayOfWeek?: unknown;
  time?: unknown;
  location?: unknown;
  distanceLabel?: unknown;
  invite?: unknown;
  externalUrl?: unknown;
  description?: unknown;
}

/**
 * A Verified Runner WITHOUT the Group Leader role may submit a one-time or
 * recurring run not tied to a group (host shows as "Independent Runner").
 * Group Leaders are blocked from the independent path — they run events
 * through their group's existing event flow.
 */
export function submitEvent(db: Db, accountId: string, input: EventSubmitInput, now = new Date()): AdminResult<SubmissionRecord> {
  const auth = requireVerifiedSubmitter(db, accountId);
  if (!auth.ok) return auth;
  // Under-review accounts may browse/RSVP/comment, but cannot host events
  // (server-enforced; see trust.ts trustRestrictions).
  const trust = trustRestrictions(auth.data);
  if (trust.hosting) {
    return {
      ok: false,
      status: 403,
      error: "under_review",
      message: "Your account is under community review — hosting is paused. You can still browse, RSVP, and comment.",
    };
  }
  if (auth.data.role === "group_leader") {
    return {
      ok: false,
      status: 403,
      error: "group_leader_independent",
      message: "Group Leaders submit runs through their group's event path, not as independent runs.",
    };
  }
  const city = resolveCity(db, auth.data, input.cityId);
  if (!city.ok) return city;
  const payload = eventPayloadFrom(input);
  if (!payload.ok) return payload;
  return { ok: true, data: db.appendSubmission(newSubmission("event", city.data, accountId, payload.data, now)) };
}

/** Server-side validation of an independent-event payload (shared with admin edit). */
export function eventPayloadFrom(input: EventSubmitInput): AdminResult<EventSubmissionPayload> {
  const type = input.type === "one_time" ? "one_time" : input.type === "recurring" ? "recurring" : null;
  if (!type) return { ok: false, status: 400, error: "invalid_type", message: "Event type must be one_time or recurring." };
  const title = sliceTrim(input.title, MAX_TITLE);
  if (!title) return { ok: false, status: 400, error: "invalid_title", message: "Run title is required." };
  const date = type === "one_time" ? sliceTrim(input.date, 10) : "";
  if (type === "one_time" && !validIsoDate(date)) {
    return { ok: false, status: 400, error: "invalid_date", message: "Event date must be a valid yyyy-mm-dd date." };
  }
  const dayOfWeek = type === "recurring" && typeof input.dayOfWeek === "number" ? input.dayOfWeek : NaN;
  if (type === "recurring" && (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6)) {
    return { ok: false, status: 400, error: "invalid_day", message: "Recurring events need a day of the week (Monday–Sunday)." };
  }
  const time = sliceTrim(input.time, 12);
  if (!TIME_RE.test(time)) {
    return { ok: false, status: 400, error: "invalid_time", message: "Time must look like “6:00 PM”." };
  }
  const location = sliceTrim(input.location, MAX_LOCATION);
  if (!location) return { ok: false, status: 400, error: "invalid_location", message: "Run location is required." };
  const distanceLabel = sliceTrim(input.distanceLabel, MAX_DISTANCE);
  if (!distanceLabel) return { ok: false, status: 400, error: "invalid_distance", message: "Add a distance/pace description (e.g. “3–5 mi, no-drop”)." };
  const inviteRaw = sliceTrim(input.invite, 20);
  const invite = (INVITES as readonly string[]).includes(inviteRaw) ? (inviteRaw as (typeof INVITES)[number]) : null;
  if (!invite) {
    return { ok: false, status: 400, error: "invalid_invite", message: "Pick an invite label: “Open to all”, “Members + guests”, or “RSVP requested”." };
  }
  const ext = optionalUrl(input.externalUrl);
  if (!ext.ok) return { ok: false, status: 400, error: ext.error };
  const description = sliceTrim(input.description, MAX_DESCRIPTION);
  const payload: EventSubmissionPayload = {
    kind: "event",
    type,
    title,
    date: type === "one_time" ? date : null,
    dayOfWeek: type === "recurring" ? dayOfWeek : null,
    time,
    location,
    distanceLabel,
    invite,
    externalUrl: ext.url,
    description,
  };
  return { ok: true, data: payload };
}

// ------------------------------------------------------------- my submissions
export interface MySubmissionView {
  id: string;
  kind: SubmissionKind;
  cityId: string;
  status: SubmissionRecord["status"];
  title: string;
  submittedAt: string;
  decidedAt: string | null;
  /** Only ever set on the SUBMITTER's own view of a rejected record. */
  rejectionReason: string | null;
}

/**
 * A submitter's own submissions — clear Pending / Approved / Rejected statuses
 * and the rejection reason when rejected. NEVER another user's records or any
 * other user's private details.
 */
export function mySubmissions(db: Db, accountId: string): MySubmissionView[] {
  return db.listSubmissionsBySubmitter(accountId).map((s) => ({
    id: s.id,
    kind: s.kind,
    cityId: s.cityId,
    status: s.status,
    title: titleFor(s.payload),
    submittedAt: s.submittedAt,
    decidedAt: s.decidedAt,
    rejectionReason: s.status === "rejected" ? s.rejectionReason : null,
    // Only a still-pending record can be withdrawn; decided/withdrawn rows are
    // history-only (the server re-validates on POST /withdraw regardless).
    capabilities: s.status === "pending" ? ["withdraw"] : [],
  }));
}

// ------------------------------------------------------------- admin queue
export interface SubmissionQueueRow {
  id: string;
  kind: SubmissionKind;
  cityId: string;
  status: SubmissionRecord["status"];
  title: string;
  submittedAt: string;
  submitterName: string;
  /** Redacted payload (no emails/phones) — admin review context only. */
  summary: string;
}

/**
 * Admin-only submission list (owner OR key-based admin). Routine reads do NOT
 * prompt for an operator reason — they are audited with the server-generated
 * routine reason. `status` filters the queue: "pending" (default, the review
 * queue), "approved", or "rejected" — the full submission history for the
 * city (or all cities for global admins). Safe summaries: title, kind,
 * submitter display name, and a short payload summary. No email, phone, IP,
 * or other user's data.
 */
export function submissionQueue(
  db: Db,
  ctx: AdminCtx,
  cityId: string | null,
  status: SubmissionStatus = "pending",
  now = new Date(),
): AdminResult<SubmissionQueueRow[]> {
  const auth = authorizeAdmin(db, routineAdminCtx(ctx), "admin.submission_list", null, now);
  if (!auth.ok) return auth;
  return submissionQueueRows(db, cityId, status);
}

/**
 * City Admin variant of the submission list — the scope city is enforced
 * server-side (the client cannot widen it), so a City Admin can NEVER see the
 * all-city queue or another city's submissions. Loads are routine (no
 * operator-entered reason); approve/reject still require one.
 */
export function citySubmissionQueue(db: Db, ctx: AdminCtx, now = new Date()): AdminResult<SubmissionQueueRow[]> {
  const auth = authorizeScoped(db, routineAdminCtx(ctx), "cityadmin.submission_list", null, now);
  if (!auth.ok) return auth;
  const cityId = auth.data.scope.kind === "city" ? auth.data.scope.cityId : null;
  if (cityId === null) return { ok: false, status: 403, error: "city_scope_denied" };
  return submissionQueueRows(db, cityId, "pending");
}

function submissionQueueRows(db: Db, cityId: string | null, status: SubmissionStatus): AdminResult<SubmissionQueueRow[]> {
  const rows = db
    .listSubmissions()
    .filter((s) => s.status === status && (!cityId || s.cityId === cityId))
    .sort((a, b) => a.submittedAt.localeCompare(b.submittedAt))
    .map((s) => {
      const submitter = db.getAccount(s.submitterAccountId);
      const summary = summarizePayload(s.payload);
      return {
        id: s.id,
        kind: s.kind,
        cityId: s.cityId,
        status: s.status,
        title: titleFor(s.payload),
        submittedAt: s.submittedAt,
        submitterName: submitter?.name ?? "Deleted account",
        summary,
      };
    });
  return { ok: true, data: rows };
}

function summarizePayload(payload: SubmissionPayload): string {
  switch (payload.kind) {
    case "race":
      return `${payload.distances} · ${payload.date} · ${payload.location}`;
    case "group":
      return `${payload.groupType} · ${payload.cityId}`;
    case "event":
      return `${payload.type === "one_time" ? payload.date : `weekly (day ${payload.dayOfWeek})`} · ${payload.time} · ${payload.location}`;
  }
}

// ------------------------------------------------------------- admin decide
export type DecideAction = "approve" | "reject";

/**
 * Admin approve/reject of a pending submission (owner or key-based admin).
 *  - approve: creates the public record. For a group, ALSO grants the
 *    submitter the Group Leader role. The RRCA badge is never granted here.
 *  - reject: stores the admin's reason (the audit reason) as the rejection
 *    reason, visible to the submitter.
 * Every action is audited with the admin identity.
 */
export function decideSubmission(
  db: Db,
  ctx: AdminCtx,
  submissionId: string,
  action: DecideAction,
  now = new Date(),
): AdminResult<SubmissionRecord> {
  const auth = authorizeAdmin(db, ctx, action === "approve" ? "admin.submission_approve" : "admin.submission_reject", submissionId, now);
  if (!auth.ok) return auth;
  return decideSubmissionCore(db, auth.data.admin, ctx.reason, submissionId, action, now);
}

/**
 * City Admin variant — the target submission's cityId MUST equal the City
 * Admin's scope. A City Admin can never approve/reject a submission from
 * another city, regardless of any client-supplied id.
 */
export function cityDecideSubmission(
  db: Db,
  ctx: AdminCtx,
  submissionId: string,
  action: DecideAction,
  now = new Date(),
): AdminResult<SubmissionRecord> {
  // Look up the record first so we can bind the authorization to its city.
  const rec = db.getSubmission(submissionId);
  if (!rec) return { ok: false, status: 404, error: "not_found" };
  const auth = authorizeScoped(
    db,
    ctx,
    action === "approve" ? "cityadmin.submission_approve" : "cityadmin.submission_reject",
    submissionId,
    now,
    { enforceCity: rec.cityId, auditCity: rec.cityId },
  );
  if (!auth.ok) return auth;
  return decideSubmissionCore(db, auth.data.admin, ctx.reason, submissionId, action, now);
}

function decideSubmissionCore(
  db: Db,
  admin: string,
  reason: string | undefined,
  submissionId: string,
  action: DecideAction,
  now: Date,
): AdminResult<SubmissionRecord> {
  const rec = db.getSubmission(submissionId);
  if (!rec) return { ok: false, status: 404, error: "not_found" };
  if (rec.status !== "pending") {
    return { ok: false, status: 409, error: "already_decided", message: "This submission was already approved or rejected." };
  }
  if (action === "reject") {
    const rejection = reason?.trim().slice(0, REASON_MAX) ?? "";
    if (!validSubmissionReason(rejection)) {
      return { ok: false, status: 400, error: "reason_required", message: "A rejection reason (5–500 chars) is required — the submitter will see it." };
    }
    const updated = db.updateSubmission(submissionId, {
      status: "rejected",
      decidedAt: now.toISOString(),
      decidedBy: admin,
      rejectionReason: rejection,
    })!;
    return { ok: true, data: updated };
  }

  // approve — create the public record (publicRefId = `user-<submissionId>`;
  // moderation registry ids are `kind:user-<submissionId>`).
  const refId = `user-${rec.id}`;
  if (rec.kind === "race" || rec.kind === "event") {
    const payload = rec.payload;
    db.upsertContent({
      id: `${rec.kind}:${refId}`,
      cityId: rec.cityId,
      kind: rec.kind,
      refId,
      title: payload.kind === "event" ? payload.title : payload.name,
      authorLabel: db.getAccount(rec.submitterAccountId)?.name ?? null,
      authorAccountId: rec.submitterAccountId,
      featured: false,
      pinned: false,
      hidden: false,
      hiddenAt: null,
      archived: false,
      archivedAt: null,
    });
    if (rec.kind === "event") {
      const eventPayload = payload as EventSubmissionPayload;
      // Materialize the same stable public id consumed by /api/events,
      // occurrence resolution, RSVP, and private occurrence discussions.
      db.setEvent({
        id: `event:${refId}`, seedRefId: null, cityId: rec.cityId,
        groupId: refId, title: eventPayload.title,
        dayOfWeek: eventPayload.dayOfWeek ?? -1,
        scheduleDate: eventPayload.date,
        recurrenceType: eventPayload.type,
        time: eventPayload.time, location: eventPayload.location,
        distanceLabel: eventPayload.distanceLabel, invite: eventPayload.invite,
        externalUrl: eventPayload.externalUrl, provenance: "community",
        status: "published", hidden: false, createdAt: now.toISOString(),
        updatedAt: now.toISOString(), createdBy: rec.submitterAccountId,
        updatedBy: admin, archivedAt: null,
      });
      // The approved event's submitter HOSTS it — record host-attendance so
      // they can rate runners who RSVP'd to their event (and vice versa). This
      // is server-authoritative: only an admin approval creates host records.

      db.addAttendance({
        id: newId(),
        accountId: rec.submitterAccountId,
        eventId: `event:${refId}`,
        role: "host",
        createdAt: now.toISOString(),
      });
    }
  } else {
    // group — create the group record (never grants the RRCA badge) and
    // grant the submitter the Group Leader role for that group.
    db.upsertGroup({
      id: refId,
      cityId: rec.cityId,
      name: (rec.payload as GroupSubmissionPayload).name,
      rrcaBadge: false,
      rrcaNote: null,
      rrcaNoteUpdatedAt: null,
      description: (rec.payload as GroupSubmissionPayload).description,
      groupType: (rec.payload as GroupSubmissionPayload).groupType,
      websiteUrl: (rec.payload as GroupSubmissionPayload).websiteUrl,
      groupmeUrl: (rec.payload as GroupSubmissionPayload).groupmeUrl,
      facebookUrl: (rec.payload as GroupSubmissionPayload).facebookUrl,
      instagramUrl: (rec.payload as GroupSubmissionPayload).instagramUrl,
      coverPhotoRef: (rec.payload as GroupSubmissionPayload).coverPhotoRef,
      logoPhotoRef: (rec.payload as GroupSubmissionPayload).logoPhotoRef,
      membershipMode: (rec.payload as GroupSubmissionPayload).membershipMode,
      status: "published",
      ownerId: rec.submitterAccountId,
      leaderIds: [rec.submitterAccountId],
    });
    const submitter = db.getAccount(rec.submitterAccountId);
    if (submitter && !submitter.deletedAt) {
      // Group approval grants the submitter the Group Leader role — pushed
      // into the multi-role set (the legacy single `role` stays in sync).
      db.updateAccount(submitter.id, addRolePatch(submitter, "group_leader"));
    }
  }
  const updated = db.updateSubmission(submissionId, {
    status: "approved",
    decidedAt: now.toISOString(),
    decidedBy: admin,
    publicRefId: refId,
  })!;
  return { ok: true, data: updated };
}

// ----------------------------------------------- super-admin submission ops
// The queue approve/reject lifecycle above is shared with City Admins (scoped
// to their city). The two operations below are SUPER-ADMIN only: a Global
// Admin (owner OR key admin) may correct a pending submission's payload before
// it is decided, and may remove a pending submission from the queue entirely
// (e.g. obvious spam that should not be routed through the rejection flow).
// City Admins and runners are denied server-side.

export type SubmissionEditInput = RaceSubmitInput | GroupSubmitInput | EventSubmitInput;

/**
 * Super-admin edit of a PENDING submission's payload. The record kind stays
 * fixed (a race stays a race), but every field is re-validated with the same
 * server-side rules as the original submit, so an admin can fix a typo, a
 * wrong date, or a bad link before approving. Audited, reason-required,
 * Global Admin only.
 */
export function editPendingSubmission(
  db: Db,
  ctx: AdminCtx,
  submissionId: string,
  input: SubmissionEditInput,
  now = new Date(),
): AdminResult<SubmissionRecord> {
  const rec = db.getSubmission(submissionId);
  if (!rec) return { ok: false, status: 404, error: "not_found" };
  const auth = authorizeScoped(db, ctx, "admin.submission_edit", submissionId, now, { globalOnly: true, auditCity: rec.cityId });
  if (!auth.ok) return auth;
  if (rec.status !== "pending") {
    return { ok: false, status: 409, error: "already_decided", message: "Only pending submissions can be edited — this one was already decided." };
  }
  let next: SubmissionPayload;
  if (rec.kind === "race") {
    const p = racePayloadFrom(input);
    if (!p.ok) return p;
    next = p.data;
  } else if (rec.kind === "group") {
    const p = groupPayloadFrom(input, rec.cityId);
    if (!p.ok) return p;
    next = p.data;
  } else {
    const p = eventPayloadFrom(input);
    if (!p.ok) return p;
    next = p.data;
  }
  const updated = db.updateSubmission(submissionId, { payload: next })!;
  return { ok: true, data: updated };
}

/**
 * Super-admin removal of a PENDING submission from the queue. Hard-removes the
 * record (no public artifact exists yet) and is audited with the admin's
 * reason. Approved submissions cannot be removed here — they have public
 * artifacts and are managed through the content hide/archive surface. Audited,
 * reason-required, Global Admin only.
 */
export function removeSubmission(
  db: Db,
  ctx: AdminCtx,
  submissionId: string,
  now = new Date(),
): AdminResult<{ id: string }> {
  const rec = db.getSubmission(submissionId);
  if (!rec) return { ok: false, status: 404, error: "not_found" };
  const auth = authorizeScoped(db, ctx, "admin.submission_remove", submissionId, now, { globalOnly: true, auditCity: rec.cityId });
  if (!auth.ok) return auth;
  if (rec.status !== "pending") {
    return { ok: false, status: 409, error: "already_decided", message: "Only pending submissions can be removed — decided records stay for the audit trail." };
  }
  db.removeSubmission(submissionId);
  return { ok: true, data: { id: submissionId } };
}

// ------------------------------------------------------- submitter withdraw
// The submitter may pull a still-pending submission back before any admin
// decision. The record is NOT removed: it flips to status "withdrawn", which
// leaves the admin pending queue (the queue filters on status === "pending")
// while staying in the submitter's own "My submissions" history with its
// withdrawn status. Author-only (404 for anyone else — never leaked), and only
// a pending record can be withdrawn (decided records return 409). Audited as
// `submission.withdraw` with the submitter identity + city.

export type WithdrawResult = AdminResult<SubmissionRecord>;

/**
 * Submit-author withdrawal of a pending submission. `accountId` is the
 * session identity (server-resolved); the record must belong to that account.
 */
export function withdrawSubmission(db: Db, accountId: string, submissionId: string, now = new Date()): WithdrawResult {
  const rec = db.getAccount(accountId);
  if (!rec || rec.deletedAt) return { ok: false, status: 401, error: "sign_in_required" };
  const sub = db.getSubmission(submissionId);
  if (!sub || sub.submitterAccountId !== rec.id) return { ok: false, status: 404, error: "not_found" };
  if (sub.status !== "pending") {
    return { ok: false, status: 409, error: "already_decided", message: "Only pending submissions can be withdrawn — this one was already decided." };
  }
  const updated = db.updateSubmission(submissionId, { status: "withdrawn", decidedAt: now.toISOString(), decidedBy: rec.email })!;
  db.appendAudit(
    {
      admin: rec.email,
      action: "submission.withdraw",
      reason: "Submitter withdrew their pending submission",
      targetId: submissionId,
      ip: "member-action",
      cityId: sub.cityId,
      owner: rec.email,
      change: `withdrawn (was pending) — ${titleFor(sub.payload)}`,
    },
    now,
  );
  return { ok: true, data: updated };
}

// ------------------------------------------------------------- public view
export interface PublicUserRace {
  id: string;
  kind: "race";
  name: string;
  date: string;
  distance: string;
  location: string;
  organizer: string;
  price: string;
  registrationUrl: string;
  registrationOpen: boolean;
  registrationNote: string;
  description: string;
}
export interface PublicUserGroup {
  id: string;
  kind: "group";
  name: string;
  groupType: "rrca-chartered" | "community";
  description: string;
  groupmeUrl: string | null;
  facebookUrl: string | null;
  instagramUrl: string | null;
  websiteUrl: string | null;
  coverPhotoUrl?: string; logoPhotoUrl?: string; membershipMode?: "open" | "request"; rrcaVerified?: boolean; leaders?: { id:string; name:string }[];
}
export interface PublicUserEvent {
  id: string;
  kind: "event";
  title: string;
  type: "one_time" | "recurring";
  date: string | null;
  dayOfWeek: number | null;
  time: string;
  location: string;
  distanceLabel: string;
  invite: "Open to all" | "Members + guests" | "RSVP requested";
  externalUrl: string | null;
  description: string;
  /** Independent submissions are always hosted by an Independent Runner. */
  host: string;
}

export interface PublicApprovedContent {
  cityId: string;
  races: PublicUserRace[];
  groups: PublicUserGroup[];
  events: PublicUserEvent[];
}

/**
 * Public (no auth) view of APPROVED community submissions for a city.
 * Deliberately excludes anything pending/rejected and any hidden content
 * (owner-moderation respected via the content registry). Host names are the
 * submitter's public display name — no emails, phones, or other account data.
 */
export function publicApprovedContent(db: Db, cityId: string): PublicApprovedContent {
  const races: PublicUserRace[] = [];
  const groups: PublicUserGroup[] = [];
  const events: PublicUserEvent[] = [];
  for (const s of db.listSubmissions()) {
    if (s.cityId !== cityId || s.status !== "approved") continue;
    if (s.kind === "race" || s.kind === "event") {
      const content = db.getContent(`${s.kind}:${s.publicRefId ?? `user-${s.id}`}`);
      // Owner-hidden OR owner-archived content never renders publicly.
      if (content?.hidden || content?.archived) continue;
    } else {
      // Groups render from the public directory rules: published + not archived.
      const group = db.getGroup(s.publicRefId ?? `user-${s.id}`);
      if (!group || (group.status ?? "published") !== "published" || group.archived) continue;
    }
    const host = db.getAccount(s.submitterAccountId)?.name ?? "Runner";
    if (s.kind === "race") {
      const p = s.payload as RaceSubmissionPayload;
      races.push({
        id: s.publicRefId ?? `user-${s.id}`,
        kind: "race",
        name: p.name,
        date: p.date,
        distance: p.distances,
        location: p.location,
        organizer: host,
        price: "TBA",
        registrationUrl: p.registrationUrl,
        registrationOpen: true,
        registrationNote: "Approved community listing — confirm on the organizer's site",
        description: p.description,
      });
    } else if (s.kind === "event") {
      const p = s.payload as EventSubmissionPayload;
      events.push({
        id: s.publicRefId ?? `user-${s.id}`,
        kind: "event",
        title: p.title,
        type: p.type,
        date: p.date,
        dayOfWeek: p.dayOfWeek,
        time: p.time,
        location: p.location,
        distanceLabel: p.distanceLabel,
        invite: p.invite,
        externalUrl: p.externalUrl,
        description: p.description,
        host: "Independent Runner",
      });
    } else {
      const p = s.payload as GroupSubmissionPayload;
      groups.push({
        id: s.publicRefId ?? `user-${s.id}`,
        kind: "group",
        name: p.name,
        groupType: p.groupType,
        description: p.description,
        groupmeUrl: p.groupmeUrl,
        facebookUrl: p.facebookUrl,
        instagramUrl: p.instagramUrl,
        websiteUrl: p.websiteUrl,
        coverPhotoUrl: p.coverPhotoRef ? `/uploads/public/${p.coverPhotoRef}` : "",
        logoPhotoUrl: p.logoPhotoRef ? `/uploads/public/${p.logoPhotoRef}` : "",
        membershipMode: p.membershipMode ?? "open",
        rrcaVerified: db.getGroup(s.publicRefId ?? `user-${s.id}`)?.rrcaBadge ?? false,
        leaders: [{ id: s.submitterAccountId, name: host }],
      });
    }
  }
  return { cityId, races, groups, events };
}
