/**
 * Canonical race registry — server-side race records, capability computation,
 * the public /api/races listing, and the public admin edit endpoint.
 *
 * Race listings come from two sources:
 *  - seed races: sample preview fixtures (client seed). Materialized into
 *    `RaceRecord` rows at startup (like `materializeSeedEvents`) so admin
 *    edits persist and serve back through /api/races.
 *  - approved community submissions: payload-driven (like the events flow);
 *    edits update the submission payload + moderation-registry title.
 *
 * Capability model (mirrors eventModeration / forum): the server computes
 * per-race capabilities for the acting user; the client renders exactly those
 * actions and ignores unknown keys. City Admins (scoped to the race's city)
 * and the Global Admin receive edit + delete. Group Leads, verified runners,
 * guests, and cross-city admins receive []. Delete is the existing
 * reason-required contentAdmin soft-delete on the `race:<id>` registry row;
 * Edit is this module's PUT /api/races/:id (audited, routine reason — no
 * operator prompt, matching the scoped event-moderation endpoint).
 */
import type { AdminCtx, AdminResult } from "./admin";
import { authorizeScoped, routineAdminCtx, sessionAccount } from "./admin";
import { isCityAdminForCity, isGlobalAdmin } from "./roles";
import { racePayloadFrom } from "./submissions";
import type { Db } from "./store";
import type { AccountRecord, RaceRecord } from "./types";
import { CITIES } from "../data/cities";

export type RaceCapability = "edit" | "delete";

/** Materialize every seed race into a canonical RaceRecord (idempotent). */
export function materializeSeedRaces(db: Db, cities = CITIES, now = new Date()): void {
  for (const city of cities) {
    for (const r of city.races) {
      if (db.getRace(r.id)) continue;
      db.setRace({
        id: r.id,
        cityId: city.id,
        refId: r.id,
        source: "seed",
        name: r.name,
        distances: r.distance,
        date: r.date,
        location: r.location,
        registrationUrl: r.registrationUrl,
        description: "",
        organizer: r.organizer,
        price: r.price,
        registrationOpen: r.registrationOpen,
        registrationNote: r.registrationNote ?? "",
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
        updatedBy: "seed",
      });
    }
  }
}

/**
 * Server-computed capabilities for one public race listing (`id` is the
 * client-facing id: the seed id like "r1", or "user-<submissionId>" for
 * approved community races — the moderation registry row is `race:<id>`).
 */
export function raceCapabilities(db: Db, actor: AccountRecord | null | undefined, race: { id: string; cityId: string }): RaceCapability[] {
  if (!actor || actor.deletedAt) return [];
  const content = db.getContent(`race:${race.id}`);
  if (content?.archived) return [];
  if (isGlobalAdmin(actor) || isCityAdminForCity(actor, race.cityId)) return ["edit", "delete"];
  return [];
}

/** Public shape of one race listing, with the acting user's capabilities. */
export interface PublicRaceView {
  id: string;
  kind: "race";
  name: string;
  /** ISO yyyy-mm-dd race date. */
  date: string;
  distance: string;
  location: string;
  organizer: string;
  price: string;
  registrationUrl: string;
  registrationOpen: boolean;
  registrationNote: string;
  description: string;
  /** "seed" (preview fixture) or "submission" (approved community listing). */
  source: "seed" | "submission";
  /** Server-computed capabilities for the requesting account (edit/delete for admins). */
  capabilities: RaceCapability[];
}

function seedView(db: Db, actor: AccountRecord | null | undefined, rec: RaceRecord): PublicRaceView | null {
  const content = db.getContent(`race:${rec.id}`);
  if (content?.hidden || content?.archived) return null;
  return {
    id: rec.id,
    kind: "race",
    name: rec.name,
    date: rec.date,
    distance: rec.distances,
    location: rec.location,
    organizer: rec.organizer,
    price: rec.price,
    registrationUrl: rec.registrationUrl,
    registrationOpen: rec.registrationOpen,
    registrationNote: rec.registrationNote,
    description: rec.description,
    source: "seed",
    capabilities: raceCapabilities(db, actor, rec),
  };
}

function submissionView(db: Db, actor: AccountRecord | null | undefined, s: import("./types").SubmissionRecord): PublicRaceView | null {
  const refId = s.publicRefId ?? `user-${s.id}`;
  const content = db.getContent(`race:${refId}`);
  if (content?.hidden || content?.archived) return null;
  const p = s.payload as import("./types").RaceSubmissionPayload;
  const host = db.getAccount(s.submitterAccountId)?.name ?? "Runner";
  return {
    id: refId,
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
    source: "submission",
    capabilities: raceCapabilities(db, actor, { id: refId, cityId: s.cityId }),
  };
}

/**
 * Public race listing for a city: seed records (canonical) + approved
 * community submissions, each with the requesting account's capabilities.
 * Hidden/archived rows are excluded (owner moderation respected). No auth.
 */
export function publicRaces(db: Db, cityId: string, actor: AccountRecord | null | undefined): PublicRaceView[] {
  materializeSeedRaces(db);
  const views: PublicRaceView[] = [];
  for (const rec of db.listRaces()) {
    if (rec.cityId !== cityId) continue;
    const v = seedView(db, actor, rec);
    if (v) views.push(v);
  }
  for (const s of db.listSubmissions()) {
    if (s.cityId !== cityId || s.status !== "approved" || s.kind !== "race") continue;
    const v = submissionView(db, actor, s);
    if (v) views.push(v);
  }
  return views.sort((a, b) => (a.date === b.date ? a.name.localeCompare(b.name) : a.date.localeCompare(b.date)));
}

/** Editable race fields — the same set as a race submission payload. */
export interface RaceEditInput {
  name?: unknown;
  distances?: unknown;
  date?: unknown;
  location?: unknown;
  registrationUrl?: unknown;
  description?: unknown;
}

/**
 * PUT /api/races/:id — admin edit of a public race listing (`id` = client id:
 * seed id or `user-<submissionId>`). Authorized through `authorizeScoped`
 * (Global Admin anywhere; City Admin exactly for the race's city). Seed races
 * update their canonical RaceRecord; community races update the source
 * submission payload (which also feeds the moderation-registry title). Both
 * re-validate with the same server rules as the original submission
 * (`racePayloadFrom`). Audited as `admin.race_edit` with a routine reason —
 * no operator prompt on this endpoint.
 */
export function editRacePublic(db: Db, ctx: AdminCtx, id: string, input: RaceEditInput, now = new Date()): AdminResult<PublicRaceView> {
  const content = db.getContent(`race:${id}`);
  if (!content) return { ok: false, status: 404, error: "not_found" };
  if (content.archived) return { ok: false, status: 409, error: "already_archived" };
  if (!content.refId.startsWith("user-")) {
    // Seed race — canonical RaceRecord must exist (materialize lazily).
    materializeSeedRaces(db);
    if (!db.getRace(id)) return { ok: false, status: 404, error: "not_found" };
  }

  const payload = racePayloadFrom(input);
  if (!payload.ok) return payload;

  const auth = authorizeScoped(db, routineAdminCtx(ctx), "admin.race_edit", content.id, now, {
    enforceCity: content.cityId,
    auditCity: content.cityId,
    owner: content.authorLabel ?? null,
    change: `race edited: "${content.title}" -> "${payload.data.name}" (${payload.data.date})`,
  });
  if (!auth.ok) return auth;
  const at = now.toISOString();
  const by = auth.data.accountId ?? auth.data.admin;

  if (content.refId.startsWith("user-")) {
    // Community race: update the source submission payload + registry title.
    const submissionId = content.refId.slice("user-".length);
    const sub = db.getSubmission(submissionId);
    if (!sub || sub.kind !== "race") return { ok: false, status: 404, error: "not_found" };
    db.updateSubmission(submissionId, { payload: { ...(sub.payload as import("./types").RaceSubmissionPayload), ...payload.data } });
  } else {
    const rec = db.getRace(id)!;
    db.setRace({ ...rec, name: payload.data.name, distances: payload.data.distances, date: payload.data.date, location: payload.data.location, registrationUrl: payload.data.registrationUrl, description: payload.data.description, updatedAt: at, updatedBy: by });
  }
  db.upsertContent({ ...content, title: payload.data.name });
  const actor = sessionAccount(db, ctx);
  return { ok: true, data: publicRaces(db, content.cityId, actor).find((r) => r.id === id)! };
}
