import { describe, expect, it } from "vitest";
import { createMemoryStore, LOGIN_IP_WINDOW_MS } from "../src/server/store";
import {
  computePurgeAt,
  countEligible,
  deleteAccount,
  isPurgeEligible,
  MS_PER_YEAR,
  purgeEligible,
} from "../src/server/retention";

const T0 = new Date("2026-08-03T00:00:00.000Z");

describe("retention calculation", () => {
  it("computePurgeAt = lastActivity + retentionYears", () => {
    expect(computePurgeAt(T0, "2026-01-01T00:00:00.000Z", 3)).toBe(
      new Date(new Date("2026-01-01T00:00:00.000Z").getTime() + 3 * MS_PER_YEAR).toISOString(),
    );
  });

  it("accounts with recent activity are not eligible", () => {
    const db = createMemoryStore({ retentionYears: 3 });
    const rec = db.createAccount({ name: "A", email: "a@x.com" });
    db.updateAccount(rec.id, { lastActivityAt: "2026-08-02T00:00:00.000Z" });
    expect(isPurgeEligible(db.getAccount(rec.id)!, T0)).toBe(false);
    expect(countEligible(db, T0)).toBe(0);
  });

  it("accounts idle past the window ARE eligible", () => {
    const db = createMemoryStore({ retentionYears: 3 });
    const rec = db.createAccount({ name: "A", email: "a@x.com" });
    db.updateAccount(rec.id, { lastActivityAt: "2020-01-01T00:00:00.000Z" });
    expect(isPurgeEligible(db.getAccount(rec.id)!, T0)).toBe(true);
  });
});

describe("purge removes selfie + phone records", () => {
  it("purgeEligible scrubs and removes eligible accounts only", async () => {
    const db = createMemoryStore({ retentionYears: 3 });
    const stale = db.createAccount({ name: "Old", email: "old@x.com" });
    db.updateAccount(stale.id, {
      lastActivityAt: "2019-06-01T00:00:00.000Z",
      phone: "+15735550123",
      selfieRef: `${stale.id}_selfie.jpg`,
      loginIps: [{ ip: "203.0.113.1", at: "2019-06-01T00:00:00.000Z" }],
    });
    const fresh = db.createAccount({ name: "New", email: "new@x.com" });
    db.updateAccount(fresh.id, {
      lastActivityAt: "2026-07-01T00:00:00.000Z",
      phone: "+15735550124",
      selfieRef: `${fresh.id}_selfie.jpg`,
    });

    const result = await purgeEligible(db, T0);
    expect(result.purged).toContain(stale.id);
    expect(result.retained).toContain(fresh.id);
    expect(db.getAccount(stale.id)).toBeUndefined();
    const kept = db.getAccount(fresh.id)!;
    expect(kept.phone).toBe("+15735550124");
    expect(kept.selfieRef).toBe(`${fresh.id}_selfie.jpg`);
  });

  it("default retention is 3 years and configurable", () => {
    expect(createMemoryStore().retentionYears).toBe(3);
    expect(createMemoryStore({ retentionYears: 5 }).retentionYears).toBe(5);
  });
});

describe("account deletion scrubs sensitive fields immediately", () => {
  it("deleteAccount clears phone, selfie ref, photo ref, signup IP, IP history", () => {
    const db = createMemoryStore();
    const rec = db.createAccount({ name: "Delete Me", email: "del@x.com" });
    db.updateAccount(rec.id, {
      phone: "+15735550123",
      phoneVerifiedAt: "2026-01-01T00:00:00.000Z",
      selfieRef: `${rec.id}_selfie.jpg`,
      selfieCapturedAt: "2026-01-01T00:00:01.000Z",
      profilePhotoRef: `${rec.id}_profile.jpg`,
      signupIp: "203.0.113.9",
      loginIps: [{ ip: "203.0.113.9", at: "2026-01-01T00:00:00.000Z" }],
    });
    const tombstone = deleteAccount(rec, T0);
    expect(tombstone.phone).toBeNull();
    expect(tombstone.selfieRef).toBeNull();
    expect(tombstone.profilePhotoRef).toBeNull();
    expect(tombstone.signupIp).toBeNull();
    expect(tombstone.loginIps).toEqual([]);
    expect(tombstone.deletedAt).toBe(T0.toISOString());
    // Non-sensitive identity retained for audit linkage.
    expect(tombstone.email).toBe("del@x.com");
    expect(tombstone.name).toBe("Delete Me");
  });
});

describe("rolling 90-day login IP history", () => {
  it("prunes entries older than 90 days on append", () => {
    const db = createMemoryStore();
    const rec = db.createAccount({ name: "Ips", email: "ips@x.com" });
    db.appendLoginIp(rec.id, "203.0.113.1", new Date(T0.getTime() - 100 * 24 * 60 * 60 * 1000)); // 100 days ago
    db.appendLoginIp(rec.id, "203.0.113.2", T0); // now — cutoff 90 days from now prunes the old entry
    const rec2 = db.getAccount(rec.id)!;
    expect(rec2.loginIps).toHaveLength(1);
    expect(rec2.loginIps[0].ip).toBe("203.0.113.2");
  });

  it("keeps entries within the 90-day window", () => {
    const db = createMemoryStore();
    const rec = db.createAccount({ name: "Ips", email: "ips2@x.com" });
    const now = T0.getTime();
    db.appendLoginIp(rec.id, "203.0.113.1", new Date(now - LOGIN_IP_WINDOW_MS + 1000)); // just inside
    db.appendLoginIp(rec.id, "203.0.113.2", new Date(now));
    expect(db.getAccount(rec.id)!.loginIps.map((e) => e.ip)).toEqual(["203.0.113.1", "203.0.113.2"]);
  });
});
