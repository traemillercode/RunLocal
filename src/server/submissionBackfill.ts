import { type Db } from "./store";
import type { EventSubmissionPayload, GroupSubmissionPayload, RaceSubmissionPayload } from "./types";

/** Repair approved submissions written by older releases. Safe to run repeatedly. */
export function repairApprovedSubmissions(db: Db, now = new Date()): { repaired: number; skipped: number } {
  let repaired = 0;
  let skipped = 0;
  for (const s of db.listSubmissions()) {
    if (s.status !== "approved") { skipped++; continue; }
    const refId = s.publicRefId ?? `user-${s.id}`;
    let changed = s.publicRefId !== refId;
    if (s.kind === "race" || s.kind === "event") {
      const p = s.payload as RaceSubmissionPayload | EventSubmissionPayload;
      const contentId = `${s.kind}:${refId}`;
      if (!db.getContent(contentId)) {
        db.upsertContent({ id: contentId, cityId: s.cityId, kind: s.kind, refId, title: s.kind === "race" ? (p as RaceSubmissionPayload).name : (p as EventSubmissionPayload).title, authorLabel: db.getAccount(s.submitterAccountId)?.name ?? null, authorAccountId: s.submitterAccountId, featured: false, pinned: false, hidden: false, hiddenAt: null, archived: false, archivedAt: null });
        changed = true;
      }
      if (s.kind === "event") {
        const ep = p as EventSubmissionPayload;
        const eventId = `event:${refId}`;
        if (!db.getEvent(eventId)) {
          db.setEvent({ id: eventId, seedRefId: null, cityId: s.cityId, groupId: refId, title: ep.title, dayOfWeek: ep.dayOfWeek ?? -1, scheduleDate: ep.date, recurrenceType: ep.type, time: ep.time, location: ep.location, distanceLabel: ep.distanceLabel, invite: ep.invite, externalUrl: ep.externalUrl, provenance: "community", status: "published", hidden: false, createdAt: s.decidedAt ?? now.toISOString(), updatedAt: now.toISOString(), createdBy: s.submitterAccountId, updatedBy: s.decidedBy ?? "backfill", archivedAt: null });
          changed = true;
        }
      }
    } else {
      const p = s.payload as GroupSubmissionPayload;
      if (!db.getGroup(refId)) {
        db.upsertGroup({ id: refId, cityId: s.cityId, name: p.name, rrcaBadge: false, rrcaNote: null, rrcaNoteUpdatedAt: null, description: p.description, groupType: p.groupType, websiteUrl: p.websiteUrl, groupmeUrl: p.groupmeUrl, facebookUrl: p.facebookUrl, instagramUrl: p.instagramUrl, coverPhotoRef: p.coverPhotoRef, logoPhotoRef: p.logoPhotoRef, membershipMode: p.membershipMode, status: "published", ownerId: s.submitterAccountId, leaderIds: [s.submitterAccountId] });
        changed = true;
      }
    }
    if (s.publicRefId !== refId) { db.updateSubmission(s.id, { publicRefId: refId }); changed = true; }
    if (changed) repaired++; else skipped++;
  }
  return { repaired, skipped };
}
