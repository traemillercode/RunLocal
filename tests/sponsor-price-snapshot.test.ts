/**
 * Sponsor price snapshot (roadmap 0.8).
 *
 * The defect this prevents is an ACCOUNTING one, not a UX one: without a
 * snapshot the price is recomputed from the current rate on every read, so
 * changing SPONSOR_DAY_RATE_USD silently rewrites what every historical
 * booking was worth. A sponsor sold a founding rate must stay at that rate,
 * and a dispute needs a number that doesn't move.
 */
import { describe, expect, it } from "vitest";
import { createMemoryStore, newId, Db } from "../src/server/store";
import type { SponsorRecord } from "../src/server/types";
import { SPONSOR_DAY_RATE_USD, SPONSOR_RATE_VERSION, sponsorTotalPriceUsd } from "../src/server/payments";
import { submitSponsorInquiry } from "../src/server/sponsors";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CITY = "columbia-mo";

function booking(over: Partial<SponsorRecord> = {}): SponsorRecord {
  const now = new Date().toISOString();
  return {
    id: newId(), cityId: CITY, tier: "standard", businessName: "Legacy Biz", tagline: "",
    linkUrl: "https://example.com", logoRef: null, active: true,
    startDate: "2026-09-01", endDate: "2026-09-07", createdAt: now, updatedAt: now,
    quotedDayRateUsd: null, quotedTotalUsd: null, quotedAt: null, rateVersion: null,
    ...over,
  };
}

describe("Price snapshot is captured at booking", () => {
  it("a new public booking records the day rate, total, timestamp, and rate version", () => {
    const db = createMemoryStore();
    const now = new Date("2026-08-29T12:00:00Z");
    const r = submitSponsorInquiry(db, {
      cityId: CITY, tier: "featured", businessName: "Founding Sponsor",
      tagline: "First in", linkUrl: "https://example.com",
      startDate: "2026-09-01", endDate: "2026-09-07",
    } as never, now);
    expect(r.ok).toBe(true);

    const rec = db.listAllSponsors(CITY).find((s) => s.businessName === "Founding Sponsor")!;
    expect(rec.quotedDayRateUsd).toBe(SPONSOR_DAY_RATE_USD.featured);
    // 7 inclusive days at the featured rate.
    expect(rec.quotedTotalUsd).toBe(SPONSOR_DAY_RATE_USD.featured * 7);
    expect(rec.quotedAt).toBe(now.toISOString());
    expect(rec.rateVersion).toBe(SPONSOR_RATE_VERSION);
  });

  it("the snapshot matches what the pricing function would have charged at that moment", () => {
    const db = createMemoryStore();
    const now = new Date("2026-08-29T12:00:00Z");
    submitSponsorInquiry(db, {
      cityId: CITY, tier: "standard", businessName: "Match Check", tagline: "",
      linkUrl: "https://example.com", startDate: "2026-10-01", endDate: "2026-10-14",
    } as never, now);
    const rec = db.listAllSponsors(CITY).find((s) => s.businessName === "Match Check")!;
    expect(rec.quotedTotalUsd).toBe(sponsorTotalPriceUsd("standard", "2026-10-01", "2026-10-14"));
  });
});

describe("A stored snapshot is immune to later rate changes", () => {
  it("the recorded total does not move when the current rate would produce a different number", () => {
    const db = createMemoryStore();
    // A booking quoted at a founding rate of $5/day for 7 days.
    const founding = booking({
      businessName: "Founding Rate Co", tier: "standard",
      quotedDayRateUsd: 5, quotedTotalUsd: 35, quotedAt: "2026-08-01T00:00:00.000Z", rateVersion: "founding-2026",
    });
    db.createSponsor(founding);

    const stored = db.getSponsor(founding.id)!;
    const currentRateWouldBe = sponsorTotalPriceUsd("standard", founding.startDate, founding.endDate);

    // The whole point: the stored quote and today's rate genuinely differ,
    // and the stored one is what survives.
    expect(stored.quotedTotalUsd).toBe(35);
    expect(currentRateWouldBe).not.toBe(35);
    expect(stored.quotedDayRateUsd).toBe(5);
    expect(stored.rateVersion).toBe("founding-2026");
  });
});

describe("Legacy bookings without a snapshot", () => {
  it("hydrate with genuine nulls rather than undefined, so the fallback is detectable", async () => {
    // Simulates a db.json written before the snapshot fields existed, loaded
    // through the real load() path rather than a synthetic helper.
    const legacy = { ...booking({ businessName: "Pre-snapshot Co" }) } as Record<string, unknown>;
    delete legacy.quotedDayRateUsd;
    delete legacy.quotedTotalUsd;
    delete legacy.quotedAt;
    delete legacy.rateVersion;

    const dir = mkdtempSync(join(tmpdir(), "kimbio-legacy-"));
    writeFileSync(join(dir, "db.json"), JSON.stringify({ sponsors: [legacy] }));

    // createMemoryStore() forces dataDir:null, so load() would no-op - use the
    // real constructor to exercise the actual on-disk hydration path.
    const db = new Db({ dataDir: dir });
    await db.load();

    const rec = db.listAllSponsors(CITY).find((s) => s.businessName === "Pre-snapshot Co")!;
    expect(rec).toBeDefined();
    expect(rec.quotedDayRateUsd).toBeNull();
    expect(rec.quotedTotalUsd).toBeNull();
    expect(rec.quotedAt).toBeNull();
    expect(rec.rateVersion).toBeNull();
  });
});
