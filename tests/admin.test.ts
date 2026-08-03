import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMemoryStore } from "../src/server/store";
import {
  ADMIN_EMAIL_VAR,
  ADMIN_KEY_VAR,
  adminConfigured,
  adminDeleteAccount,
  adminExportRows,
  adminGetRecord,
  adminLogin,
  adminSearch,
  adminSetStatus,
  toCsv,
  validReason,
  type AdminCtx,
} from "../src/server/admin";

const KEY = "test-admin-key-123";
const EMAIL = "safety@runlocal.app";
const T0 = new Date("2026-08-03T00:00:00.000Z");

function ctx(adminSessionId: string | null, reason?: string): AdminCtx {
  return { adminSessionId, reason, ip: "198.51.100.7" };
}

describe("admin authorization", () => {
  beforeEach(() => {
    process.env[ADMIN_KEY_VAR] = KEY;
    process.env[ADMIN_EMAIL_VAR] = EMAIL;
  });
  afterEach(() => {
    delete process.env[ADMIN_KEY_VAR];
    delete process.env[ADMIN_EMAIL_VAR];
  });

  it("is unconfigured when the admin key env var is missing", () => {
    delete process.env[ADMIN_KEY_VAR];
    expect(adminConfigured()).toBe(false);
    const db = createMemoryStore();
    const r = adminLogin(db, KEY, "198.51.100.7", T0);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("admin_unconfigured");
  });

  it("rejects a wrong admin key and audits the failed attempt", () => {
    const db = createMemoryStore();
    const r = adminLogin(db, "wrong-key", "198.51.100.7", T0);
    expect(r.ok).toBe(false);
    const audits = db.listAudit(10);
    expect(audits.some((a) => a.action === "admin.login" && a.reason.includes("Failed"))).toBe(true);
  });

  it("issues an admin session on a valid key", () => {
    const db = createMemoryStore();
    const r = adminLogin(db, KEY, "198.51.100.7", T0);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.admin).toBe(EMAIL);
  });

  it("search requires an admin session", () => {
    const db = createMemoryStore();
    const r = adminSearch(db, ctx(null, "reviewing a report"), "jordan", T0);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("unauthorized");
  });

  it("search requires a reason and audits the lookup", () => {
    const db = createMemoryStore();
    const login = adminLogin(db, KEY, "198.51.100.7", T0);
    if (!login.ok) throw new Error("login failed");
    const r = adminSearch(db, ctx(login.data.sessionId), "jordan", T0);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("reason_required");
    expect(db.listAudit(10).filter((a) => a.action === "admin.search")).toHaveLength(0);
  });

  it("reason must be meaningful (5–500 chars)", () => {
    expect(validReason("ok")).toBe(false);
    expect(validReason("    ")).toBe(false);
    expect(validReason("safety review")).toBe(true);
    expect(validReason("x".repeat(501))).toBe(false);
  });

  it("successful search masks the phone and audits with admin/reason", () => {
    const db = createMemoryStore();
    const rec = db.createAccount({ name: "Jordan Lee", email: "jordan@example.com" });
    db.updateAccount(rec.id, { phone: "+15735550123" });
    const login = adminLogin(db, KEY, "198.51.100.7", T0);
    if (!login.ok) throw new Error("login failed");
    const r = adminSearch(db, ctx(login.data.sessionId, "safety review of a report"), "jordan", T0);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data).toHaveLength(1);
      expect(r.data[0].phoneLast4).toBe("0123");
      expect(JSON.stringify(r.data)).not.toContain("+15735550123"); // full phone never in search results
    }
    const audits = db.listAudit(10);
    const searchAudit = audits.find((a) => a.action === "admin.search")!;
    expect(searchAudit.admin).toBe(EMAIL);
    expect(searchAudit.reason).toBe("safety review of a report");
    expect(searchAudit.ip).toBe("198.51.100.7");
  });

  it("full record view is audited and includes sensitive fields for admins only", () => {
    const db = createMemoryStore();
    const rec = db.createAccount({ name: "Jordan Lee", email: "jordan@example.com" });
    db.updateAccount(rec.id, { phone: "+15735550123", signupIp: "203.0.113.9", selfieRef: `${rec.id}_selfie.jpg` });
    const login = adminLogin(db, KEY, "198.51.100.7", T0);
    if (!login.ok) throw new Error("login failed");
    const r = adminGetRecord(db, ctx(login.data.sessionId, "viewing flagged account"), rec.id, T0);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.phone).toBe("+15735550123");
      expect(r.data.signupIp).toBe("203.0.113.9");
      expect(r.data.canViewSelfie).toBe(true);
    }
    const audits = db.listAudit(10);
    expect(audits.some((a) => a.action === "admin.view_record" && a.targetId === rec.id)).toBe(true);
  });

  it("approve transitions pending → verified (requires pending_review + selfie) and is audited", () => {
    const db = createMemoryStore();
    const rec = db.createAccount({ name: "A", email: "a@x.com" });
    db.updateAccount(rec.id, { phase: "pending_review", selfieRef: `${rec.id}_selfie.jpg` });
    const login = adminLogin(db, KEY, "198.51.100.7", T0);
    if (!login.ok) throw new Error("login failed");
    const r = adminSetStatus(db, ctx(login.data.sessionId, "identity confirmed by staff"), rec.id, "verified", T0);
    expect(r.ok).toBe(true);
    expect(db.getAccount(rec.id)!.status).toBe("verified");
    expect(db.getAccount(rec.id)!.verifiedAt).toBe(T0.toISOString());
    expect(db.listAudit(10).some((a) => a.action === "admin.approve" && a.targetId === rec.id)).toBe(true);
  });

  it("approve without a reason is rejected", () => {
    const db = createMemoryStore();
    const rec = db.createAccount({ name: "A", email: "a@x.com" });
    const login = adminLogin(db, KEY, "198.51.100.7", T0);
    if (!login.ok) throw new Error("login failed");
    const r = adminSetStatus(db, ctx(login.data.sessionId), rec.id, "verified", T0);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("reason_required");
  });

  it("delete requires authorization and removes the account", () => {
    const db = createMemoryStore();
    const rec = db.createAccount({ name: "A", email: "a@x.com" });
    const r = adminDeleteAccount(db, ctx(null, "no session"), rec.id, T0);
    expect(r.ok).toBe(false);
    const login = adminLogin(db, KEY, "198.51.100.7", T0);
    if (!login.ok) throw new Error("login failed");
    const r2 = adminDeleteAccount(db, ctx(login.data.sessionId, "abuse — removing"), rec.id, T0);
    expect(r2.ok).toBe(true);
    expect(db.getAccount(rec.id)).toBeUndefined();
    expect(db.listAudit(10).some((a) => a.action === "admin.delete" && a.targetId === rec.id)).toBe(true);
  });

  it("export requires a reason and is audited; CSV contains no newline injection", () => {
    const db = createMemoryStore();
    const rec = db.createAccount({ name: 'Doe, "Jane"', email: "jane@example.com" });
    db.updateAccount(rec.id, { phone: "+15735550123", signupIp: "203.0.113.5" });
    const login = adminLogin(db, KEY, "198.51.100.7", T0);
    if (!login.ok) throw new Error("login failed");
    const noReason = adminExportRows(db, ctx(login.data.sessionId), "", T0);
    expect(noReason.ok).toBe(false);
    const r = adminExportRows(db, ctx(login.data.sessionId, "exporting for safety review"), "", T0);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const csv = toCsv(r.data.rows);
      expect(csv).toContain('"Doe, ""Jane"""');
      expect(csv).toContain("+15735550123");
      expect(db.listAudit(10).some((a) => a.action === "admin.export")).toBe(true);
    }
  });

  it("audit log entries contain admin/timestamp/reason/action", () => {
    const db = createMemoryStore();
    const rec = db.createAccount({ name: "A", email: "a@x.com" });
    const login = adminLogin(db, KEY, "198.51.100.7", T0);
    if (!login.ok) throw new Error("login failed");
    adminGetRecord(db, ctx(login.data.sessionId, "checking record"), rec.id, T0);
    const entries = db.listAudit(10);
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) {
      expect(typeof e.at).toBe("string");
      expect(e.action.length).toBeGreaterThan(0);
      expect(e.reason.length).toBeGreaterThan(0);
      expect(e.admin.length).toBeGreaterThan(0);
    }
  });

  it("group leaders / verified runners cannot reach admin handlers (no admin session)", () => {
    const db = createMemoryStore();
    // Simulate a verified runner's user session id — not an admin session.
    const runner = db.createAccount({ name: "Runner", email: "r@x.com" });
    const session = db.createSession(runner.id, "203.0.113.2", T0);
    const r = adminSearch(db, ctx(session.id, "I am a verified runner"), "anything", T0);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("unauthorized");
  });
});
