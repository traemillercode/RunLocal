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
import type { AdminCtx, AdminResult } from "./admin";
import { authorizeAdmin } from "./admin";
import { REASON_MAX, REASON_MIN } from "./admin";
import { isSupportedCityId } from "../data/cities";
import type {
  AccountRecord,
  EventSubmissionPayload,
  GroupSubmissionPayload,
  RaceSubmissionPayload,
  SubmissionKind,
  SubmissionPayload,
  SubmissionRecord,
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
 * Resolve the submission's city: an explicit supported cityId wins; otherwise
 * the submitter's home city. Never client-trusted — validated against the
 * known city entities.
 */
function resolveCity(rec: AccountRecord, cityIdParam: unknown): AdminResult<string> {
  let cityId = typeof cityIdParam === "string" ? cityIdParam.trim() : "";
  if (!cityId) cityId = rec.cityId ?? "";
  if (!cityId) {
    return { ok: false, status: 400, error: "city_required", message: "This submission needs a city — set your home city or pass a cityId." };
  }
  if (!isSupportedCityId(cityId)) {
    return { ok: false, status: 400, error: "invalid_city", message: "That city isn't supported yet — pick one from the list." };
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
  const city = resolveCity(auth.data, input.cityId);
  if (!city.ok) return city;
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
  return { ok: true, data: db.appendSubmission(newSubmission("race", city.data, accountId, payload, now)) };
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
  const city = resolveCity(auth.data, input.cityId);
  if (!city.ok) return city;
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
  const payload: GroupSubmissionPayload = {
    kind: "group",
    name,
    description,
    cityId: city.data,
    groupType,
    groupmeUrl: groupme.url,
    facebookUrl: facebook.url,
    instagramUrl: instagram.url,
    websiteUrl: website.url,
  };
  return { ok: true, data: db.appendSubmission(newSubmission("group", city.data, accountId, payload, now)) };
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
  if (auth.data.role === "group_leader") {
    return {
      ok: false,
      status: 403,
      error: "group_leader_independent",
      message: "Group Leaders submit runs through their group's event path, not as independent runs.",
    };
  }
  const city = resolveCity(auth.data, input.cityId);
  if (!city.ok) return city;
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
  return { ok: true, data: db.appendSubmission(newSubmission("event", city.data, accountId, payload, now)) };
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
 * Admin-only pending-submission queue (owner OR key-based admin; audited with
 * a required reason). Safe summaries: title, kind, submitter display name,
 * and a short payload summary. No email, phone, IP, or other user's data.
 */
export function submissionQueue(
  db: Db,
  ctx: AdminCtx,
  cityId: string | null,
  now = new Date(),
): AdminResult<SubmissionQueueRow[]> {
  const auth = authorizeAdmin(db, ctx, "admin.submission_list", null, now);
  if (!auth.ok) return auth;
  const rows = db
    .listSubmissions()
    .filter((s) => s.status === "pending" && (!cityId || s.cityId === cityId))
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
  const rec = db.getSubmission(submissionId);
  if (!rec) return { ok: false, status: 404, error: "not_found" };
  if (rec.status !== "pending") {
    return { ok: false, status: 409, error: "already_decided", message: "This submission was already approved or rejected." };
  }
  const admin = auth.data.admin;
  if (action === "reject") {
    const reason = ctx.reason?.trim().slice(0, REASON_MAX) ?? "";
    if (!validSubmissionReason(reason)) {
      return { ok: false, status: 400, error: "reason_required", message: "A rejection reason (5–500 chars) is required — the submitter will see it." };
    }
    const updated = db.updateSubmission(submissionId, {
      status: "rejected",
      decidedAt: now.toISOString(),
      decidedBy: admin,
      rejectionReason: reason,
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
    });
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
    });
    const submitter = db.getAccount(rec.submitterAccountId);
    if (submitter && !submitter.deletedAt) {
      db.updateAccount(submitter.id, { role: "group_leader" });
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
      if (content?.hidden) continue; // owner-hidden content never renders publicly
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
      });
    }
  }
  return { cityId, races, groups, events };
}
