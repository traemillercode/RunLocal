/**
 * Rejected-account semantics — Task 7 verification UX follow-up.
 *
 * Rejection stores an explicit applicant-facing reason (required, persisted,
 * PRIVATE to the applicant via /api/me), clears any current verified/badge
 * presentation (verifiedAt + trustedMember), and stays audited. Credential
 * decisions keep the per-row decision note (credential.decisionReason)
 * separate from the audit reason header.
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import { apiHandler } from "../src/server/api";
import { createMemoryStore, type Db, toPublicAccount } from "../src/server/store";
import { DEFAULT_OWNER_EMAIL, OWNER_EMAIL_VAR } from "../src/server/owner";
import { ADMIN_COOKIE, SESSION_COOKIE } from "../src/server/api";
import { ADMIN_KEY_VAR, ADMIN_EMAIL_VAR, adminLogin } from "../src/server/admin";
import type { AccountRecord, CredentialRecord } from "../src/server/types";

const KEY = "test-admin-key-123";
const ADMIN_EMAIL = "admin@runlocal.app";
const AUDIT_REASON = "Selfie did not match the provided ID photo";

function req(method: string, path: string, cookie?: string, body?: unknown, reason?: string): IncomingMessage {
  const raw = body === undefined ? "" : JSON.stringify(body);
  let sent = false;
  const headers: Record<string, string> = { "x-forwarded-proto": "https", ...(raw ? { "content-type": "application/json" } : {}) };
  if (cookie) headers.cookie = cookie;
  if (reason) headers["x-audit-reason"] = reason;
  return { method, url: path, headers, socket: { remoteAddress: "127.0.0.1" }, [Symbol.asyncIterator]() { return { next: async () => sent ? { done: true as const, value: undefined } : (sent = true, { done: false as const, value: Buffer.from(raw) }) }; } } as unknown as IncomingMessage;
}
function response() {
  const out = { status: 0, body: "" };
  const res = { writeHead(status: number) { out.status = status; return res; }, setHeader() { return res; }, end(value?: unknown) { if (value !== undefined) out.body += String(value); return res; } } as unknown as ServerResponse;
  return { res, out };
}
async function call(db: Db, method: string, path: string, cookie?: string, body?: unknown, reason?: string) {
  const { res, out } = response();
  await apiHandler(req(method, path, cookie, body, reason), res, db);
  return { status: out.status, body: out.body ? (JSON.parse(out.body) as Record<string, any>) : {} };
}
function account(db: Db, email: string, cityId = "columbia-mo", patch: Partial<AccountRecord> = {}): { id: string; cookie: string; email: string } {
  const a = db.createAccount({ name: email, email, cityId });
  db.updateAccount(a.id, { status: "verified", ...patch });
  const s = db.createSession(a.id, "127.0.0.1");
  return { id: a.id, cookie: `${SESSION_COOKIE}=${s.id}`, email: a.email };
}
function pendingApplicant(db: Db, email: string): { id: string; cookie: string } {
  // A user who completed email + selfie steps is in pending_review with a
  // stored selfie (the only state approval accepts).
  const a = db.createAccount({ name: email, email, cityId: "columbia-mo" });
  db.updateAccount(a.id, { status: "pending", phase: "pending_review", selfieRef: "selfies/x.jpg" });
  const s = db.createSession(a.id, "127.0.0.1");
  return { id: a.id, cookie: `${SESSION_COOKIE}=${s.id}` };
}
function keyAdminCookie(db: Db): string {
  const login = adminLogin(db, KEY, "127.0.0.1");
  if (!login.ok) throw new Error("key login failed");
  return `${ADMIN_COOKIE}=${login.data.sessionId}`;
}
const audit = (db: Db, action: string) => db.listAudit(100).filter((a) => a.action === action);

describe("Rejected-account semantics", () => {
  beforeEach(() => {
    process.env[ADMIN_KEY_VAR] = KEY;
    process.env[ADMIN_EMAIL_VAR] = ADMIN_EMAIL;
  });
  afterEach(() => {
    delete process.env[ADMIN_KEY_VAR];
    delete process.env[ADMIN_EMAIL_VAR];
    delete process.env[OWNER_EMAIL_VAR];
  });

  it("rejection requires an explicit applicant-facing reason in the body", async () => {
    const db = createMemoryStore();
    const owner = account(db, DEFAULT_OWNER_EMAIL);
    const applicant = pendingApplicant(db, "applicant@example.com");
    // No body reason -> 400, account untouched.
    const r = await call(db, "POST", `/api/admin/records/${applicant.id}/reject`, owner.cookie, {}, AUDIT_REASON);
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("reason_required");
    expect(db.getAccount(applicant.id)!.status).toBe("pending");
    expect(audit(db, "admin.reject")).toHaveLength(0);
  });

  it("rejection stores the private reason, clears verified/badge state, and is audited", async () => {
    const db = createMemoryStore();
    const owner = account(db, DEFAULT_OWNER_EMAIL);
    const applicant = pendingApplicant(db, "applicant@example.com");
    // Simulate a previously approved + trusted member whose verification is
    // revoked by rejection: the presentation must be fully cleared.
    db.updateAccount(applicant.id, { status: "verified", verifiedAt: "2026-08-01T00:00:00.000Z", trustedMember: true, trustedMemberAt: "2026-08-01T00:00:00.000Z" });
    const REJECT_REASON = "Your selfie did not match your photo ID — please reapply with a clearer photo.";
    const r = await call(db, "POST", `/api/admin/records/${applicant.id}/reject`, owner.cookie, { reason: REJECT_REASON }, AUDIT_REASON);
    expect(r.status).toBe(200);
    const rec = db.getAccount(applicant.id)!;
    expect(rec.status).toBe("rejected");
    expect(rec.rejectionReason).toBe(REJECT_REASON);
    expect(rec.verifiedAt).toBeNull();
    expect(rec.trustedMember).toBe(false);
    expect(rec.trustedMemberAt).toBeNull();
    // Audited: reason header recorded separately from the applicant-facing reason.
    const rows = audit(db, "admin.reject");
    expect(rows).toHaveLength(1);
    expect(rows[0].targetId).toBe(applicant.id);
    expect(rows[0].reason).toBe(AUDIT_REASON);
    // Private projection: the applicant's own /api/me carries the reason.
    const me = await call(db, "GET", "/api/me", applicant.cookie);
    expect(me.status).toBe(200);
    expect(me.body.account.status).toBe("rejected");
    expect(me.body.account.rejectionReason).toBe(REJECT_REASON);
    expect(me.body.account.role).not.toBe("verified");
    // Public projection rule: reason only ever appears for rejected status.
    expect(toPublicAccount(rec).rejectionReason).toBe(REJECT_REASON);
    expect(toPublicAccount(db.getAccount(owner.id)!).rejectionReason).toBeNull();
  });

  it("rejection without a stored reason is impossible (reason_required guard)", async () => {
    const db = createMemoryStore();
    const owner = account(db, DEFAULT_OWNER_EMAIL);
    const applicant = pendingApplicant(db, "applicant@example.com");
    const r = await call(db, "POST", `/api/admin/records/${applicant.id}/reject`, owner.cookie, { reason: "no" }, AUDIT_REASON);
    expect(r.status).toBe(400);
    expect(db.getAccount(applicant.id)!.rejectionReason).toBeNull();
  });

  it("a fresh approval clears the prior rejection reason", async () => {
    const db = createMemoryStore();
    const owner = account(db, DEFAULT_OWNER_EMAIL);
    const applicant = pendingApplicant(db, "applicant@example.com");
    const r1 = await call(db, "POST", `/api/admin/records/${applicant.id}/reject`, owner.cookie, { reason: "Selfie blurry, please retake." }, AUDIT_REASON);
    expect(r1.status).toBe(200);
    const r2 = await call(db, "POST", `/api/admin/records/${applicant.id}/approve`, owner.cookie, undefined, "Applicant retook a clear selfie");
    expect(r2.status).toBe(200);
    const rec = db.getAccount(applicant.id)!;
    expect(rec.status).toBe("verified");
    expect(rec.rejectionReason).toBeNull();
    expect(rec.verifiedAt).toBeTruthy();
  });

  it("credential rejection: the per-row note is the decisionReason; the audit header stays the audit reason", async () => {
    const db = createMemoryStore();
    const owner = account(db, DEFAULT_OWNER_EMAIL);
    const runner = account(db, "runner@example.com");
    const c: CredentialRecord = {
      id: "c".repeat(32), accountId: runner.id, type: "coach_certification", certifyingBody: "RRCA",
      proofRef: null, proofMime: null, proofBytes: 0, issuedOn: null, expiresOn: null,
      status: "pending_review", verifiedBy: null, verifiedAt: null, decisionReason: null,
      renewalNotifiedAt: null, createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z",
    };
    db.addCredential(c);
    const NOTE = "Document does not show a valid RRCA certification";
    const r = await call(db, "POST", `/api/admin/credentials/${c.id}/reject`, owner.cookie, { reason: NOTE }, AUDIT_REASON);
    expect(r.status).toBe(200);
    expect(db.getCredential(c.id)!.status).toBe("rejected");
    // The per-row decision note reaches the applicant-facing decisionReason…
    expect(db.getCredential(c.id)!.decisionReason).toBe(NOTE);
    // …while the audit entry keeps the operator's separate audit reason.
    const rows = audit(db, "admin.reject");
    expect(rows).toHaveLength(1);
    expect(rows[0].targetId).toBe(c.id);
    expect(rows[0].reason).toBe(AUDIT_REASON);
  });
});
