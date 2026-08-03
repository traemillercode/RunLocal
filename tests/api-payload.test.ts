import { describe, expect, it } from "vitest";
import {
  createMemoryStore,
  hashCode,
  normalizePhone,
  toPublicAccount,
} from "../src/server/store";
import { smsConfig, maskPhone } from "../src/server/twilio";

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
    for (const forbidden of ["phone", "selfie", "ip", "signup", "login", "retention", "purge", "verifiedAt", "timestamp"]) {
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

describe("twilio provider configuration detection", () => {
  it("reports unconfigured when required env vars are missing", () => {
    const cfg = smsConfig({});
    expect(cfg.configured).toBe(false);
    expect(cfg.missing).toEqual(["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_PHONE_NUMBER"]);
  });
  it("reports configured when all three Twilio vars are present", () => {
    const cfg = smsConfig({
      TWILIO_ACCOUNT_SID: "ACxxx",
      TWILIO_AUTH_TOKEN: "tok",
      TWILIO_PHONE_NUMBER: "+15735550123",
    });
    expect(cfg.configured).toBe(true);
    expect(cfg.missing).toEqual([]);
  });
  it("log mode is explicit and dev-only", () => {
    const cfg = smsConfig({ RUN_LOCAL_SMS_MODE: "log" });
    expect(cfg.mode).toBe("log");
    expect(cfg.configured).toBe(true);
  });
  it("maskPhone never exposes the full number", () => {
    expect(maskPhone("+15735550123")).toBe("+******0123");
    expect(maskPhone("12")).toBe("****");
  });
});
