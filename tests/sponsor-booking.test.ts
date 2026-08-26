import { describe, expect, it } from "vitest";
import { createMemoryStore, newId } from "../src/server/store";
import type { SponsorRecord } from "../src/server/types";

function makeSponsor(over: Partial<SponsorRecord> = {}): SponsorRecord {
  const now = new Date().toISOString();
  return {
    id: newId(),
    cityId: "columbia-mo",
    tier: "standard",
    businessName: "Test Biz",
    tagline: "",
    linkUrl: "https://example.com",
    logoRef: null,
    active: true,
    startDate: "2026-09-01",
    endDate: "2026-09-07",
    createdAt: now,
    updatedAt: now,
    ...over,
  };
}

describe("sponsor date-range booking (real capacity enforcement, not just count-based)", () => {
  it("featured (cap 1): a second overlapping booking is rejected, a non-overlapping one is allowed", () => {
    const db = createMemoryStore();
    const first = db.createSponsor(makeSponsor({ tier: "featured", startDate: "2026-09-01", endDate: "2026-09-07" }));
    expect(first).not.toBeNull();

    const overlap = db.createSponsor(makeSponsor({ tier: "featured", startDate: "2026-09-05", endDate: "2026-09-10" }));
    expect(overlap).toBeNull();

    const adjacent = db.createSponsor(makeSponsor({ tier: "featured", startDate: "2026-09-08", endDate: "2026-09-10" }));
    expect(adjacent).not.toBeNull();

    const before = db.createSponsor(makeSponsor({ tier: "featured", startDate: "2026-08-01", endDate: "2026-08-05" }));
    expect(before).not.toBeNull();
  });

  it("standard (cap 3): a 4th overlapping booking is rejected, but overlapping up to 3 is fine", () => {
    const db = createMemoryStore();
    const a = db.createSponsor(makeSponsor({ tier: "standard", startDate: "2026-10-01", endDate: "2026-10-10" }));
    const b = db.createSponsor(makeSponsor({ tier: "standard", startDate: "2026-10-01", endDate: "2026-10-10" }));
    const c = db.createSponsor(makeSponsor({ tier: "standard", startDate: "2026-10-01", endDate: "2026-10-10" }));
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(c).not.toBeNull();

    const d = db.createSponsor(makeSponsor({ tier: "standard", startDate: "2026-10-05", endDate: "2026-10-06" }));
    expect(d).toBeNull();

    const partialOverlap = db.createSponsor(makeSponsor({ tier: "standard", startDate: "2026-10-08", endDate: "2026-10-15" }));
    expect(partialOverlap).toBeNull();

    const after = db.createSponsor(makeSponsor({ tier: "standard", startDate: "2026-10-11", endDate: "2026-10-15" }));
    expect(after).not.toBeNull();
  });

  it("pending (unpaid) bookings never occupy a slot - two people can hold overlapping pending inquiries, only the first to pay wins", () => {
    const db = createMemoryStore();
    const pendingA = db.createSponsor(makeSponsor({ tier: "featured", active: false, startDate: "2026-11-01", endDate: "2026-11-05" }));
    const pendingB = db.createSponsor(makeSponsor({ tier: "featured", active: false, startDate: "2026-11-01", endDate: "2026-11-05" }));
    expect(pendingA).not.toBeNull();
    expect(pendingB).not.toBeNull();

    const confirmedA = db.updateSponsor(pendingA!.id, { active: true });
    expect(confirmedA).not.toBeNull();

    const confirmedB = db.updateSponsor(pendingB!.id, { active: true });
    expect(confirmedB).toBeNull();
  });

  it("listActiveSponsors only returns bookings whose date window includes today, even if active=true", () => {
    const db = createMemoryStore();
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const farFuture = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);

    db.createSponsor(makeSponsor({ tier: "standard", active: true, startDate: yesterday, endDate: yesterday }));
    const live = db.createSponsor(makeSponsor({ tier: "standard", active: true, startDate: yesterday, endDate: tomorrow }));
    db.createSponsor(makeSponsor({ tier: "standard", active: true, startDate: farFuture, endDate: farFuture }));
    db.createSponsor(makeSponsor({ tier: "standard", active: false, startDate: yesterday, endDate: tomorrow }));

    const activeNow = db.listActiveSponsors("columbia-mo");
    expect(activeNow.map((s) => s.id)).toEqual([live!.id]);
  });
});
