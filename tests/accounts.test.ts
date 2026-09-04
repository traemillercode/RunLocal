import { describe, expect, it } from "vitest";
import { canDo, phaseLabel, roleOf, type Me } from "../src/lib/accounts";
import { toPublicAccount, createMemoryStore } from "../src/server/store";

describe("permission gating (canDo)", () => {
  it("verified runners can RSVP, comment, post, and submit", () => {
    for (const action of ["rsvp", "comment", "post", "submit"] as const) {
      expect(canDo("verified", action), `verified can ${action}`).toBe(true);
    }
  });
  it("pending users are read-only — no RSVP/comment/post/submit", () => {
    for (const action of ["rsvp", "comment", "post", "submit"] as const) {
      expect(canDo("pending", action), `pending cannot ${action}`).toBe(false);
    }
  });
  it("guests are read-only — no RSVP/comment/post/submit", () => {
    for (const action of ["rsvp", "comment", "post", "submit"] as const) {
      expect(canDo("guest", action), `guest cannot ${action}`).toBe(false);
    }
  });
});

describe("roleOf", () => {
  it("maps guest / pending / verified me payloads to roles", () => {
    const guest: Me = { status: "guest" };
    const pending: Me = { status: "signed_in", account: { id: "a", name: "N", email: "n@x.com", username: "n_runner", cityId: "columbia-mo", status: "pending", phase: "pending_review", badge: null, role: "runner", roles: ["runner"], isOwner: false, suspended: false, underReview: false, profilePhotoUrl: null } };
    const verified: Me = { status: "signed_in", account: { id: "b", name: "V", email: "v@x.com", username: "v_runner", cityId: "columbia-mo", status: "verified", phase: null, badge: "verified", role: "runner", roles: ["runner"], isOwner: false, suspended: false, underReview: false, profilePhotoUrl: null } };
    expect(roleOf(guest)).toBe("guest");
    expect(roleOf(pending)).toBe("pending");
    expect(roleOf(verified)).toBe("verified");
  });
});

describe("phase labels", () => {
  it("gives copy for each funnel stage", () => {
    expect(phaseLabel("email")).toMatch(/email/i);
    expect(phaseLabel("code")).toMatch(/code/i);
    expect(phaseLabel("selfie")).toMatch(/selfie/i);
    expect(phaseLabel("pending_review")).toMatch(/review/i);
  });
});

describe("public payloads never leak sensitive verification data", () => {
  it("toPublicAccount excludes phone, selfie ref, IPs, timestamps, retention", () => {
    const db = createMemoryStore();
    const rec = db.createAccount({ name: "Jordan Lee", email: "jordan@example.com" });
    db.updateAccount(rec.id, {
      phone: "+15735550123",
      phoneVerifiedAt: "2026-08-03T00:00:00.000Z",
      selfieRef: `${rec.id}_selfie.jpg`,
      selfieCapturedAt: "2026-08-03T00:00:01.000Z",
      signupIp: "203.0.113.9",
      loginIps: [{ ip: "203.0.113.9", at: "2026-08-03T00:00:00.000Z" }],
      status: "verified",
      verifiedAt: "2026-08-03T01:00:00.000Z",
      purgeAt: "2029-08-03T00:00:00.000Z",
    });
    const pub = toPublicAccount(db.getAccount(rec.id)!);
    const json = JSON.stringify(pub);
    expect(pub.badge).toBe("verified");
    expect(pub.profilePhotoUrl).toBeNull();
    // The home city id is PUBLIC profile identity (never sensitive) and is
    // surfaced as null for legacy accounts that have not chosen one.
    expect(pub.cityId).toBeNull();
    // Sensitive values must not appear anywhere in the public payload.
    expect(json).not.toContain("+15735550123");
    expect(json).not.toContain("573555");
    expect(json).not.toContain("selfie");
    expect(json).not.toContain("203.0.113.9");
    expect(json).not.toContain("loginIps");
    expect(json).not.toContain("signupIp");
    expect(json).not.toContain("purgeAt");
    expect(json).not.toContain("verifiedAt");
    // Only these fields are exposed - verified against the actual runtime
    // shape of toPublicAccount, not hand-maintained, so a real new field
    // (like isGeofenceExempt) updates this list deliberately rather than a
    // stale expectation silently drifting from what's actually returned.
    expect(Object.keys(pub).sort()).toEqual(
      ["adminCityId", "avatarStyle", "badge", "bio", "cityId", "customTitle", "email", "facebookUrl", "id", "instagramUrl", "isGeofenceExempt", "isOwner", "name", "paceLabel", "phase", "priorRejectionReason", "profilePhotoUrl", "rejectionReason", "role", "roles", "runningGoal", "showSocialLinks", "status", "suspended", "tiktokUrl", "trainingBlock", "trustedMember", "underReview", "upcomingRaces", "username"].sort(),
    );
  });

  it("legacy accounts without a username surface username: null and keep every other field", () => {
    const db = createMemoryStore();
    const rec = db.createAccount({ name: "Legacy", email: "legacy@example.com" });
    expect(rec.username).toBeNull();
    expect(rec.cityId).toBeNull();
    const pub = toPublicAccount(db.getAccount(rec.id)!);
    expect(pub.username).toBeNull();
    expect(pub.cityId).toBeNull();
    // Legacy fields still resolve exactly as before — nothing else changed.
    expect(pub.name).toBe("Legacy");
    expect(pub.email).toBe("legacy@example.com");
    expect(pub.status).toBe("pending");
  });
});
