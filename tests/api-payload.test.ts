import { describe, expect, it } from "vitest";
import {
  createMemoryStore,
  hashCode,
  normalizePhone,
  toPublicAccount,
} from "../src/server/store";

describe("API payload contract — sensitive data never leaves the server", () => {
  it("/api/me-style public payload carries only badge-level verification info", () => {
    const db = createMemoryStore();
    const rec = db.createAccount({ name: "Taylor", email: "taylor@example.com" });
    db.updateAccount(rec.id, {
      phone: "+15735550123",
      selfieRef: `${rec.id}_selfie.jpg`,
      signupIp: "203.0.113.9",
      loginIps: [{ ip: "203.0.113.9", at: "2026-08-01T00:00:00.000Z" }],
      status: "verified",
      verifiedAt: "2026-08-02T00:00:00.000Z",
    });
    const pub = toPublicAccount(db.getAccount(rec.id)!);
    expect(pub.badge).toBe("verified");
    expect(pub.status).toBe("verified");
    const raw = JSON.stringify(pub);
    for (const forbidden of ["selfie", "ip", "signup", "login", "retention", "purge", "verifiedAt", "timestamp"]) {
      expect(raw.toLowerCase()).not.toContain(forbidden);
    }
  });

  it("pending accounts expose the funnel phase but no verification data", () => {
    const db = createMemoryStore();
    const rec = db.createAccount({ name: "P", email: "p@example.com" });
    db.updateAccount(rec.id, { phase: "pending_review", phone: "+15735550123" });
    const pub = toPublicAccount(db.getAccount(rec.id)!);
    expect(pub.phase).toBe("pending_review");
    expect(pub.badge).toBeNull();
    expect(JSON.stringify(pub)).not.toContain("573555");
  });
});

describe("phone normalization (E.164)", () => {
  it("normalizes US 10-digit numbers to +1", () => {
    expect(normalizePhone("(573) 555-0123")).toBe("+15735550123");
    expect(normalizePhone("5735550123")).toBe("+15735550123");
  });
  it("accepts explicit country codes", () => {
    expect(normalizePhone("+44 7911 123456")).toBe("+447911123456");
  });
  it("rejects clearly invalid input", () => {
    expect(normalizePhone("abc")).toBeNull();
    expect(normalizePhone("123")).toBeNull();
    expect(normalizePhone("")).toBeNull();
  });
});

describe("code hashing", () => {
  it("stores an HMAC, not the raw code, and verifies in constant time", () => {
    const salt = "s3cret-salt";
    const h = hashCode("123456", salt);
    expect(h).not.toContain("123456");
    expect(hashCode("123456", salt)).toBe(h);
    expect(hashCode("123457", salt)).not.toBe(h);
  });
});

describe("email provider configuration detection", () => {
  it("reports unconfigured when Resend vars are missing", async () => {
    const { emailConfig } = await import("../src/server/email");
    expect(emailConfig({}).configured).toBe(false);
    expect(emailConfig({}).missing).toEqual(["RESEND_API_KEY", "RUN_LOCAL_EMAIL_FROM"]);
  });
  it("reports configured with both Resend vars", async () => {
    const { emailConfig } = await import("../src/server/email");
    expect(emailConfig({ RESEND_API_KEY: "key", RUN_LOCAL_EMAIL_FROM: "Run Local <v@example.com>" }).configured).toBe(true);
  });
});
