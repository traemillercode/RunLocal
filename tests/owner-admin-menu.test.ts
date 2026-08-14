import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMemoryStore } from "../src/server/store";
import {
  ADMIN_KEY_VAR,
  ADMIN_EMAIL_VAR,
  adminPending,
  adminSetStatus,
  authorizeAdmin,
  type AdminCtx,
} from "../src/server/admin";
import { DEFAULT_OWNER_EMAIL, OWNER_EMAIL_VAR, isOwnerEmail, ownerEmail } from "../src/server/owner";
import { profileMenuEntries, isPendingAccount } from "../src/lib/accountMenu";
import type { Me } from "../src/lib/accounts";

const KEY = "test-admin-key-123";
const ADMIN_EMAIL = "safety@runlocal.app";
const T0 = new Date("2026-08-03T00:00:00.000Z");

function ctx(adminSessionId: string | null, userSessionId?: string | null, reason?: string): AdminCtx {
  return { adminSessionId, userSessionId: userSessionId ?? null, reason, ip: "198.51.100.7" };
}

describe("owner super-admin identity (server-side)", () => {
  beforeEach(() => {
    process.env[ADMIN_KEY_VAR] = KEY;
    process.env[ADMIN_EMAIL_VAR] = ADMIN_EMAIL;
  });
  afterEach(() => {
    delete process.env[ADMIN_KEY_VAR];
    delete process.env[ADMIN_EMAIL_VAR];
    delete process.env[OWNER_EMAIL_VAR];
  });

  it("defaults RUN_LOCAL_OWNER_EMAIL to the owner's address", () => {
    expect(ownerEmail({})).toBe(DEFAULT_OWNER_EMAIL);
    expect(ownerEmail({})).toBe("traemiller.email@gmail.com");
  });

  it("honors an explicit RUN_LOCAL_OWNER_EMAIL override", () => {
    expect(ownerEmail({ [OWNER_EMAIL_VAR]: "  Owner@Example.com  " })).toBe("owner@example.com");
  });

  it("isOwnerEmail is case-insensitive and exact (no substring match)", () => {
    expect(isOwnerEmail("traemiller.email@gmail.com")).toBe(true);
    expect(isOwnerEmail("TRAEMILLER.EMAIL@GMAIL.COM")).toBe(true);
    expect(isOwnerEmail("traemiller.email@gmail.com.evil.example")).toBe(false);
    expect(isOwnerEmail("someone-else@gmail.com")).toBe(false);
  });

  it("owner session authorizes admin actions and audits with the owner email", () => {
    const db = createMemoryStore();
    const owner = db.createAccount({ name: "Owner", email: DEFAULT_OWNER_EMAIL });
    const session = db.createSession(owner.id, "198.51.100.7", T0);
    const r = authorizeAdmin(db, ctx(null, session.id, "reviewing a safety report"), "admin.search", null, T0);
    expect(r.ok).toBe(true);
    const audit = db.listAudit(10)[0];
    expect(audit.action).toBe("admin.search");
    expect(audit.admin).toBe(DEFAULT_OWNER_EMAIL);
    expect(audit.reason).toBe("reviewing a safety report");
  });

  it("owner is authorized even when the admin key is unconfigured", () => {
    delete process.env[ADMIN_KEY_VAR];
    const db = createMemoryStore();
    const owner = db.createAccount({ name: "Owner", email: DEFAULT_OWNER_EMAIL });
    const session = db.createSession(owner.id, "198.51.100.7", T0);
    const r = authorizeAdmin(db, ctx(null, session.id, "queue review"), "admin.pending_list", null, T0);
    expect(r.ok).toBe(true);
  });

  it("owner action without a reason is rejected and not audited", () => {
    const db = createMemoryStore();
    const owner = db.createAccount({ name: "Owner", email: DEFAULT_OWNER_EMAIL });
    const session = db.createSession(owner.id, "198.51.100.7", T0);
    const r = authorizeAdmin(db, ctx(null, session.id), "admin.search", null, T0);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("reason_required");
    expect(db.listAudit(10)).toHaveLength(0);
  });
});

describe("non-owner denial", () => {
  beforeEach(() => {
    process.env[ADMIN_KEY_VAR] = KEY;
  });
  afterEach(() => {
    delete process.env[ADMIN_KEY_VAR];
    delete process.env[OWNER_EMAIL_VAR];
  });

  it("a verified runner's session is denied admin access even with a valid reason", () => {
    const db = createMemoryStore();
    const runner = db.createAccount({ name: "Runner", email: "runner@example.com" });
    db.updateAccount(runner.id, { status: "verified", phase: "pending_review", selfieRef: "x.jpg", role: "runner" });
    const session = db.createSession(runner.id, "203.0.113.2", T0);
    const r = authorizeAdmin(db, ctx(null, session.id, "I am a verified runner"), "admin.search", null, T0);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("unauthorized");
  });

  it("a group leader's session is denied admin access", () => {
    const db = createMemoryStore();
    const leader = db.createAccount({ name: "Leader", email: "leader@example.com" });
    db.updateAccount(leader.id, { role: "group_leader" });
    const session = db.createSession(leader.id, "203.0.113.3", T0);
    const r = authorizeAdmin(db, ctx(null, session.id, "I run a club"), "admin.search", null, T0);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("unauthorized");
  });

  it("the owner-only pending queue rejects key-based admin sessions", async () => {
    const db = createMemoryStore();
    const { adminLogin } = await import("../src/server/admin");
    const login = adminLogin(db, KEY, "198.51.100.7", T0);
    if (!login.ok) throw new Error("login failed");
    const r = adminPending(db, ctx(login.data.sessionId, null), T0);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("unauthorized");
  });
});

describe("pending-user admin actions", () => {
  beforeEach(() => {
    process.env[ADMIN_KEY_VAR] = KEY;
  });
  afterEach(() => {
    delete process.env[ADMIN_KEY_VAR];
    delete process.env[OWNER_EMAIL_VAR];
  });

  function ownerCtx(db: ReturnType<typeof createMemoryStore>, reason = "pending queue review"): AdminCtx {
    const owner = db.createAccount({ name: "Owner", email: DEFAULT_OWNER_EMAIL });
    // The owner is a fully verified signed-in user in reality — keep them out
    // of the pending queue so fixtures control exactly which accounts it shows.
    db.updateAccount(owner.id, { status: "verified", verifiedAt: T0.toISOString() });
    const session = db.createSession(owner.id, "198.51.100.7", T0);
    return ctx(null, session.id, reason);
  }

  it("lists only pending accounts with redacted rows (no phone/selfie/IP)", () => {
    const db = createMemoryStore();
    const pending = db.createAccount({ name: "Jordan Lee", email: "jordan@example.com", requestedRole: "group_leader" });
    db.updateAccount(pending.id, { phase: "pending_review", phone: "+15735550123", selfieRef: `${pending.id}_selfie.jpg`, signupIp: "203.0.113.9" });
    const verified = db.createAccount({ name: "Verified", email: "v@example.com" });
    db.updateAccount(verified.id, { status: "verified", phase: "pending_review", selfieRef: "y.jpg" });
    const r = adminPending(db, ownerCtx(db), T0);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data).toHaveLength(1);
      expect(r.data[0].email).toBe("jordan@example.com");
      expect(r.data[0].requestedRole).toBe("group_leader");
      const json = JSON.stringify(r.data);
      expect(json).not.toContain("573555");
      expect(json).not.toContain("selfie");
      expect(json).not.toContain("203.0.113.9");
      expect(json).not.toContain("loginIps");
    }
    expect(db.listAudit(10).some((a) => a.action === "admin.pending_list")).toBe(false);
  });

  it("cannot approve a user as Verified without the pending_review verification state", () => {
    const db = createMemoryStore();
    const rec = db.createAccount({ name: "A", email: "a@x.com" }); // phase "email", no selfie
    const r = adminSetStatus(db, ownerCtx(db, "approving after review"), rec.id, "verified", T0, "runner");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("verification_incomplete");
    expect(db.getAccount(rec.id)!.status).toBe("pending");
  });

  it("approves only after email + selfie review, assigning the selected role", () => {
    const db = createMemoryStore();
    const rec = db.createAccount({ name: "A", email: "a@x.com", requestedRole: "runner" });
    db.updateAccount(rec.id, { phase: "pending_review", selfieRef: `${rec.id}_selfie.jpg` });
    const r = adminSetStatus(db, ownerCtx(db, "identity confirmed"), rec.id, "verified", T0, "group_leader");
    expect(r.ok).toBe(true);
    const after = db.getAccount(rec.id)!;
    expect(after.status).toBe("verified");
    expect(after.role).toBe("group_leader");
    expect(after.verifiedAt).toBe(T0.toISOString());
    expect(db.listAudit(10).some((a) => a.action === "admin.approve" && a.targetId === rec.id)).toBe(true);
  });

  it("reject works without the verification state requirement and is audited", () => {
    const db = createMemoryStore();
    const rec = db.createAccount({ name: "B", email: "b@x.com" });
    const r = adminSetStatus(db, ownerCtx(db, "duplicate account"), rec.id, "rejected", T0, "runner", "Duplicate account — please use your existing profile");
    expect(r.ok).toBe(true);
    expect(db.getAccount(rec.id)!.status).toBe("rejected");
    expect(db.listAudit(10).some((a) => a.action === "admin.reject" && a.targetId === rec.id)).toBe(true);
  });
});

describe("profile menu states", () => {
  function me(accountPatch: Partial<import("../src/lib/accounts").PublicAccount> = {}): Me {
    return {
      status: "signed_in",
      account: {
        id: "x",
        name: "Taylor",
        email: "t@example.com",
        username: "taylor_runs",
        cityId: "columbia-mo",
        status: "pending",
        phase: "pending_review",
        badge: null,
        role: "runner",
        isOwner: false,
        suspended: false,
        underReview: false,
        profilePhotoUrl: null,
        ...accountPatch,
        roles: accountPatch.roles ?? ["runner"],
      },
    };
  }

  it("guests see Sign up and Log in (and never an admin entry)", () => {
    const { entries } = profileMenuEntries({ status: "guest" });
    expect(entries.map((e) => e.label)).toEqual(["Sign up", "Log in"]);
  });

  it("pending users see verification progress and no admin entry", () => {
    const { entries } = profileMenuEntries(me({}));
    const labels = entries.map((e) => e.label);
    expect(labels).toContain("Verification & account status");
    expect(labels).toContain("Settings");
    expect(labels).toContain("Log out");
    expect(labels).not.toContain("Admin control center");
    expect(isPendingAccount(me({}))).toBe(true);
  });

  it("verified users see the verified status entry", () => {
    const { entries } = profileMenuEntries(me({ status: "verified", phase: null, badge: "verified" }));
    expect(entries.map((e) => e.label)).toContain("My verification status");
    expect(entries.find((e) => e.key === "status")?.hint).toContain("Verified");
  });

  it("owner sees the Admin / Super Admin entry", () => {
    const { entries } = profileMenuEntries(me({ isOwner: true, roles: ["site_admin"] }));
    const admin = entries.find((e) => e.key === "admin");
    expect(admin).toBeDefined();
    expect(admin?.label).toBe("Admin control center");
    expect(admin?.hint).toBe("Super Admin");
    expect(admin?.to).toBe("/admin");
  });

  it("city admin sees the Admin entry scoped to their city", () => {
    const { entries } = profileMenuEntries(me({ status: "verified", phase: null, badge: "verified", role: "city_admin", roles: ["city_admin"], adminCityId: "columbia-mo" }));
    const admin = entries.find((e) => e.to === "/admin");
    expect(admin).toBeDefined();
    expect(admin?.label).toBe("City admin");
    expect(admin?.hint).toBe("Columbia");
    expect(admin?.key).toBe("city-admin");
  });

  it("verified non-admin runners never see an admin entry", () => {
    const { entries } = profileMenuEntries(me({ status: "verified", phase: null, badge: "verified" }));
    expect(entries.some((e) => e.to === "/admin")).toBe(false);
    expect(entries.map((e) => e.label)).not.toContain("Admin control center");
    expect(entries.map((e) => e.label)).not.toContain("City admin");
  });

  it("signedInLabel carries the account name", () => {
    expect(profileMenuEntries(me({})).signedInLabel).toBe("Taylor");
  });
});
