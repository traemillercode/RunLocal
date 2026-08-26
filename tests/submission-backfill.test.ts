import { describe, expect, it } from "vitest";
import { createMemoryStore } from "../src/server/store";
import { repairApprovedSubmissions } from "../src/server/submissionBackfill";
import type { SubmissionRecord } from "../src/server/types";

const now = "2026-08-03T00:00:00.000Z";
function approved(kind: SubmissionRecord["kind"], id: string, payload: SubmissionRecord["payload"]): SubmissionRecord {
  return { id, kind, cityId: "columbia-mo", status: "approved", submitterAccountId: "author", submittedAt: now, decidedAt: now, decidedBy: "admin", rejectionReason: null, payload, publicRefId: null };
}

describe("approved submission backfill", () => {
  it("is idempotent for legacy race, event, and group rows", () => {
    const db = createMemoryStore();
    db.createAccount({ name: "Author", email: "author@example.com", cityId: "columbia-mo" });
    db.appendSubmission(approved("race", "race-old", { kind: "race", name: "Legacy 5K", distances: "5K", date: "2026-10-01", location: "Park", registrationUrl: "https://example.com/r", description: "Race" }));
    db.appendSubmission(approved("event", "event-old", { kind: "event", type: "recurring", title: "Legacy Hills", dayOfWeek: 3, time: "6:00 PM", location: "Trail", distanceLabel: "3 mi", invite: "Open to all", date: null, externalUrl: null, description: "Hills" }));
    db.appendSubmission(approved("group", "group-old", { kind: "group", name: "Legacy Club", description: "Club", groupType: "community", facebookUrl: null, instagramUrl: null, websiteUrl: null, coverPhotoRef: "cover", logoPhotoRef: "logo", membershipMode: "request", cityId: "columbia-mo" }));
    const first = repairApprovedSubmissions(db, new Date(now));
    const snapshot = { submissions: db.listSubmissions(), content: [db.getContent("race:user-race-old"), db.getContent("event:user-event-old")], event: db.getEvent("event:user-event-old"), group: db.getGroup("user-group-old") };
    const second = repairApprovedSubmissions(db, new Date(now));
    expect(first.repaired).toBe(3);
    expect(second).toEqual({ repaired: 0, skipped: 3 });
    expect(db.listSubmissions()).toEqual(snapshot.submissions);
    expect(db.getContent("race:user-race-old")).toEqual(snapshot.content[0]);
    expect(db.getContent("event:user-event-old")).toEqual(snapshot.content[1]);
    expect(db.getEvent("event:user-event-old")).toEqual(snapshot.event);
    expect(db.getGroup("user-group-old")).toEqual(snapshot.group);
    expect(db.getContent("race:user-race-old")?.cityId).toBe("columbia-mo");
    expect(db.getContent("race:user-race-old")?.hidden).toBe(false);
  });
});
