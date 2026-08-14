/**
 * Server-level tests for the queue decision flows (sequence item 1):
 *  - Approve is a ROUTINE super-admin action: no typed reason is forced; the
 *    audit log still records the action with the admin identity, and the
 *    reason field carries a system label when the operator supplied none.
 *  - Reject REQUIRES the operator's reason, and that reason is applicant-
 *    facing end-to-end: stored on the submission record and returned to the
 *    submitter through their own My Submissions view (and on the account for
 *    verification rejections).
 *  - City Admin session can reach the /admin surface (scoped routine read).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ADMIN_EMAIL_VAR, ADMIN_KEY_VAR, adminSetStatus, type AdminCtx } from "../src/server/admin";
import { DEFAULT_OWNER_EMAIL } from "../src/server/owner";
import { createMemoryStore, type Db } from "../src/server/store";
import { decideSubmission, mySubmissions } from "../src/server/submissions";
import { adminOverview } from "../src/server/adminOverview";
import type { SubmissionRecord } from "../src/server/types";

const KEY = "test-admin-key-123";
const ADMIN_EMAIL = "safety@runlocal.app";
const T0 = new Date("2026-08-03T00:00:00.000Z");

function ownerCtx(db: Db, reason?: string): AdminCtx {
  const owner = db.createAccount({ name: "Owner", email: DEFAULT_OWNER_EMAIL });
  db.updateAccount(owner.id, { status: "verified", verifiedAt: T0.toISOString() });
  const session = db.createSession(owner.id, "198.51.100.7", T0);
  return { adminSessionId: null, userSessionId: session.id, reason, ip: "198.51.100.7" };
}

function pendingRace(db: Db, submitterId: string, id = "a".repeat(32)): SubmissionRecord {
  const rec: SubmissionRecord = {
    id,
    kind: "race",
    cityId: "columbia-mo",
    status: "pending",
    submitterAccountId: submitterId,
    submittedAt: T0.toISOString(),
    decidedAt: null,
    decidedBy: null,
    rejectionReason: null,
    payload: { kind: "race", name: "River 5K", distances: "5K / 10K", date: "2026-10-01", location: "Downtown", registrationUrl: "https://example.com/r", description: "Riverfront course" },
    publicRefId: null,
  };
  db.appendSubmission(rec);
  return rec;
}

describe("submission queue approve is routine (no typed reason)", () => {
  beforeEach(() => {
    process.env[ADMIN_KEY_VAR] = KEY;
    process.env[ADMIN_EMAIL_VAR] = ADMIN_EMAIL;
  });
  afterEach(() => {
    delete process.env[ADMIN_KEY_VAR];
    delete process.env[ADMIN_EMAIL_VAR];
  });

  it("approves without ANY reason, still audits the action with the admin identity", () => {
    const db = createMemoryStore();
    const submitter = db.createAccount({ name: "Submitter", email: "s@example.com" });
    const sub = pendingRace(db, submitter.id);
    // No operator reason supplied (routine approve).
    const r = decideSubmission(db, ownerCtx(db), sub.id, "approve", T0);
    expect(r.ok).toBe(true);
    const after = db.getSubmission(sub.id)!;
    expect(after.status).toBe("approved");
    expect(after.decidedBy).toBe(DEFAULT_OWNER_EMAIL);
    const audit = db.listAudit(10).find((a) => a.action === "admin.submission_approve");
    expect(audit).toBeDefined();
    expect(audit!.admin).toBe(DEFAULT_OWNER_EMAIL);
    // The reason field is system-labeled, never empty — the trail stays complete.
    expect(audit!.reason).toBe("Routine submission approval");
  });

  it("keeps an operator-entered reason on the audit entry when one is supplied", () => {
    const db = createMemoryStore();
    const submitter = db.createAccount({ name: "Submitter", email: "s@example.com" });
    const sub = pendingRace(db, submitter.id);
    const r = decideSubmission(db, ownerCtx(db, "verified registration link"), sub.id, "approve", T0);
    expect(r.ok).toBe(true);
    const audit = db.listAudit(10).find((a) => a.action === "admin.submission_approve");
    expect(audit!.reason).toBe("verified registration link");
  });
});

describe("submission queue reject requires an applicant-facing reason", () => {
  beforeEach(() => {
    process.env[ADMIN_KEY_VAR] = KEY;
    process.env[ADMIN_EMAIL_VAR] = ADMIN_EMAIL;
  });
  afterEach(() => {
    delete process.env[ADMIN_KEY_VAR];
    delete process.env[ADMIN_EMAIL_VAR];
  });

  it("refuses to reject without a reason", () => {
    const db = createMemoryStore();
    const submitter = db.createAccount({ name: "Submitter", email: "s@example.com" });
    const sub = pendingRace(db, submitter.id);
    const r = decideSubmission(db, ownerCtx(db), sub.id, "reject", T0);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("reason_required");
    expect(db.getSubmission(sub.id)!.status).toBe("pending");
  });

  it("stores the reason on the record and returns it to the submitter via My Submissions", () => {
    const db = createMemoryStore();
    const submitter = db.createAccount({ name: "Submitter", email: "s@example.com" });
    const sub = pendingRace(db, submitter.id);
    const r = decideSubmission(db, ownerCtx(db, "Duplicate of the existing race listing"), sub.id, "reject", T0);
    expect(r.ok).toBe(true);
    const after = db.getSubmission(sub.id)!;
    expect(after.status).toBe("rejected");
    expect(after.rejectionReason).toBe("Duplicate of the existing race listing");
    // Applicant-facing: the submitter's own view carries the reason...
    const view = mySubmissions(db, submitter.id);
    expect(view[0].rejectionReason).toBe("Duplicate of the existing race listing");
    // ...and it never leaks into the admin queue row (safe summaries only).
    expect(JSON.stringify(db.listSubmissions())).toContain("Duplicate");
  });
});

describe("pending-user approve is routine; reject keeps the applicant-facing reason", () => {
  beforeEach(() => {
    process.env[ADMIN_KEY_VAR] = KEY;
    process.env[ADMIN_EMAIL_VAR] = ADMIN_EMAIL;
  });
  afterEach(() => {
    delete process.env[ADMIN_KEY_VAR];
    delete process.env[ADMIN_EMAIL_VAR];
  });

  it("approves a pending_review user WITHOUT a reason and audits it", () => {
    const db = createMemoryStore();
    const rec = db.createAccount({ name: "A", email: "a@x.com" });
    db.updateAccount(rec.id, { phase: "pending_review", selfieRef: `${rec.id}_selfie.jpg` });
    const r = adminSetStatus(db, ownerCtx(db), rec.id, "verified", T0, "runner");
    expect(r.ok).toBe(true);
    expect(db.getAccount(rec.id)!.status).toBe("verified");
    const audit = db.listAudit(10).find((a) => a.action === "admin.approve" && a.targetId === rec.id);
    expect(audit).toBeDefined();
    expect(audit!.reason).toBe("Routine approval");
  });

  it("reject without a reason is refused; with a reason it lands on the account", () => {
    const db = createMemoryStore();
    const c = ownerCtx(db);
    const rec = db.createAccount({ name: "B", email: "b@x.com" });
    const refused = adminSetStatus(db, c, rec.id, "rejected", T0, "runner", null);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error).toBe("reason_required");
    const ok = adminSetStatus(db, c, rec.id, "rejected", T0, "runner", "Duplicate account");
    expect(ok.ok).toBe(true);
    expect(db.getAccount(rec.id)!.rejectionReason).toBe("Duplicate account");
  });
});

describe("city admin can reach the /admin surface (scoped routine read)", () => {
  it("a city-admin session authorizes the overview probe the /admin page uses", () => {
    const db = createMemoryStore();
    const cityAdmin = db.createAccount({ name: "City", email: "city@example.com" });
    db.updateAccount(cityAdmin.id, { status: "verified", role: "city_admin", adminCityId: "columbia-mo" });
    const session = db.createSession(cityAdmin.id, "198.51.100.7", T0);
    const r = adminOverview(db, { adminSessionId: null, userSessionId: session.id, ip: "198.51.100.7" }, T0);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.scope.kind).toBe("city");
      expect(r.data.scope.cityId).toBe("columbia-mo");
    }
  });

  it("a plain verified runner is denied the same probe (no admin surface)", () => {
    const db = createMemoryStore();
    const runner = db.createAccount({ name: "Runner", email: "r@example.com" });
    db.updateAccount(runner.id, { status: "verified", role: "runner" });
    const session = db.createSession(runner.id, "198.51.100.7", T0);
    const r = adminOverview(db, { adminSessionId: null, userSessionId: session.id, ip: "198.51.100.7" }, T0);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("unauthorized");
  });
});
