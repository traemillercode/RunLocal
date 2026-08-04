/**
 * Owner dashboard: authorization, reason-required + audited actions,
 * moderation (dismiss/hide/unhide), suspensions (expiry + posting block),
 * RRCA notes, featured/pinned toggles, payload safety, and seeding.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMemoryStore, isSuspended, canPost, toPublicAccount } from "../src/server/store";
import {
  ADMIN_KEY_VAR,
  ADMIN_EMAIL_VAR,
  adminLogin,
  type AdminCtx,
} from "../src/server/admin";
import {
  dashboardOverview,
  liftSuspension,
  moderateFlag,
  publicModerated,
  setContentHighlight,
  setGroupRrca,
  suspendAccount,
  unhideContent,
} from "../src/server/dashboard";
import { seedContentRegistry, seedSampleFlags } from "../src/server/contentSeed";
import { DEFAULT_OWNER_EMAIL, OWNER_EMAIL_VAR } from "../src/server/owner";

const KEY = "test-admin-key-123";
const ADMIN_EMAIL = "safety@runlocal.app";
const T0 = new Date("2026-08-03T00:00:00.000Z");
const CITY = "columbia-mo";

function ctx(adminSessionId: string | null, userSessionId?: string | null, reason?: string): AdminCtx {
  return { adminSessionId, userSessionId: userSessionId ?? null, reason, ip: "198.51.100.7" };
}

/** A verified, signed-in owner (kept out of the pending queue). */
function ownerCtx(db: ReturnType<typeof createMemoryStore>, reason = "dashboard review"): AdminCtx {
  const owner = db.createAccount({ name: "Owner", email: DEFAULT_OWNER_EMAIL });
  db.updateAccount(owner.id, { status: "verified", verifiedAt: T0.toISOString() });
  const session = db.createSession(owner.id, "198.51.100.7", T0);
  return ctx(null, session.id, reason);
}

describe("owner dashboard authorization", () => {
  beforeEach(() => {
    process.env[ADMIN_KEY_VAR] = KEY;
    process.env[ADMIN_EMAIL_VAR] = ADMIN_EMAIL;
  });
  afterEach(() => {
    delete process.env[ADMIN_KEY_VAR];
    delete process.env[ADMIN_EMAIL_VAR];
    delete process.env[OWNER_EMAIL_VAR];
  });

  it("owner session can load the dashboard and the access is audited", () => {
    const db = createMemoryStore();
    const r = dashboardOverview(db, ownerCtx(db), CITY, T0);
    expect(r.ok).toBe(true);
    expect(db.listAudit(10).some((a) => a.action === "admin.dashboard" && a.reason === "dashboard review")).toBe(true);
  });

  it("key-based admin sessions are rejected (owner-only dashboard)", () => {
    const db = createMemoryStore();
    const login = adminLogin(db, KEY, "198.51.100.7", T0);
    if (!login.ok) throw new Error("login failed");
    const r = dashboardOverview(db, ctx(login.data.sessionId, null, "I am the admin"), CITY, T0);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("unauthorized");
    expect(db.listAudit(10).some((a) => a.action === "admin.dashboard")).toBe(false);
  });

  it("a verified runner's session is rejected", () => {
    const db = createMemoryStore();
    const runner = db.createAccount({ name: "Runner", email: "r@x.com" });
    db.updateAccount(runner.id, { status: "verified", phase: "pending_review", selfieRef: "x.jpg" });
    const session = db.createSession(runner.id, "203.0.113.2", T0);
    const r = dashboardOverview(db, ctx(null, session.id, "I am a verified runner"), CITY, T0);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("unauthorized");
  });

  it("every dashboard action requires a reason and is not audited without one", () => {
    const db = createMemoryStore();
    const r = dashboardOverview(db, ctx(null, null), CITY, T0);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("reason_required");
    expect(db.listAudit(10)).toHaveLength(0);
  });
});

describe("flag moderation (dismiss / hide / unhide)", () => {
  beforeEach(() => {
    process.env[ADMIN_KEY_VAR] = KEY;
  });
  afterEach(() => {
    delete process.env[ADMIN_KEY_VAR];
  });

  function seeded(db: ReturnType<typeof createMemoryStore>) {
    seedContentRegistry(db);
    seedSampleFlags(db, T0);
    return db;
  }

  it("dismiss resolves the flag and keeps the content visible", () => {
    const db = seeded(createMemoryStore());
    const flag = db.listFlags()[0];
    const r = moderateFlag(db, ownerCtx(db, "no action needed"), flag.id, "dismiss", T0);
    expect(r.ok).toBe(true);
    expect(db.getFlag(flag.id)!.status).toBe("dismissed");
    expect(publicModerated(db, CITY).hidden).not.toContain(flag.contentId);
    const audit = db.listAudit(10).find((a) => a.action === "admin.flag_dismiss")!;
    expect(audit.targetId).toBe(flag.id);
    expect(audit.reason).toBe("no action needed");
  });

  it("hide hides the content publicly and resolves the flag", () => {
    const db = seeded(createMemoryStore());
    const flag = db.listFlags()[0];
    const r = moderateFlag(db, ownerCtx(db, "misleading information"), flag.id, "hide", T0);
    expect(r.ok).toBe(true);
    expect(db.getFlag(flag.id)!.status).toBe("hidden");
    expect(db.getContent(flag.contentId)!.hidden).toBe(true);
    expect(publicModerated(db, CITY).hidden).toContain(flag.contentId);
    expect(db.listAudit(10).some((a) => a.action === "admin.flag_hide")).toBe(true);
  });

  it("moderating an already-resolved flag is rejected (409)", () => {
    const db = seeded(createMemoryStore());
    const flag = db.listFlags()[0];
    moderateFlag(db, ownerCtx(db, "first action"), flag.id, "dismiss", T0);
    const r = moderateFlag(db, ownerCtx(db, "second action"), flag.id, "hide", T0);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("already_resolved");
    expect(db.getContent(flag.contentId)!.hidden).toBe(false);
  });

  it("unhide reverses a hide and is audited", () => {
    const db = seeded(createMemoryStore());
    const flag = db.listFlags()[0];
    moderateFlag(db, ownerCtx(db, "hiding temporarily"), flag.id, "hide", T0);
    const r = unhideContent(db, ownerCtx(db, "rechecked the facts"), flag.contentId, T0);
    expect(r.ok).toBe(true);
    expect(db.getContent(flag.contentId)!.hidden).toBe(false);
    expect(publicModerated(db, CITY).hidden).not.toContain(flag.contentId);
    expect(db.listAudit(10).some((a) => a.action === "admin.content_unhide")).toBe(true);
  });

  it("unhiding content that is not hidden is rejected", () => {
    const db = seeded(createMemoryStore());
    const r = unhideContent(db, ownerCtx(db), "event:mon-social", T0);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("not_hidden");
  });
});

describe("suspensions (posting-blocking, optional expiry)", () => {
  beforeEach(() => {
    process.env[ADMIN_KEY_VAR] = KEY;
  });
  afterEach(() => {
    delete process.env[ADMIN_KEY_VAR];
  });

  function runner(db: ReturnType<typeof createMemoryStore>, email = "a@x.com") {
    const rec = db.createAccount({ name: "A Runner", email });
    db.updateAccount(rec.id, { status: "verified", phase: "pending_review", selfieRef: `${rec.id}_selfie.jpg` });
    return rec;
  }

  it("indefinite suspension blocks posting until lifted", () => {
    const db = createMemoryStore();
    const rec = runner(db);
    const r = suspendAccount(db, ownerCtx(db, "repeated harassment"), rec.id, null, T0);
    expect(r.ok).toBe(true);
    const after = db.getAccount(rec.id)!;
    expect(after.suspendedUntil).toBeNull();
    expect(after.suspensionReason).toBe("repeated harassment");
    expect(isSuspended(after, new Date("2026-12-01T00:00:00.000Z"))).toBe(true);
    expect(canPost(after, T0).ok).toBe(false);
    const dash = dashboardOverview(db, ownerCtx(db), CITY, T0);
    expect(dash.ok && dash.data.suspensions.some((s) => s.accountId === rec.id)).toBe(true);
    expect(db.listAudit(10).some((a) => a.action === "admin.suspend" && a.targetId === rec.id)).toBe(true);
  });

  it("day-bounded suspension auto-expires", () => {
    const db = createMemoryStore();
    const rec = runner(db);
    suspendAccount(db, ownerCtx(db, "two week timeout"), rec.id, 14, T0);
    const during = db.getAccount(rec.id)!;
    expect(isSuspended(during, new Date(T0.getTime() + 13 * 24 * 60 * 60 * 1000))).toBe(true);
    const after = db.getAccount(rec.id)!;
    expect(isSuspended(after, new Date(T0.getTime() + 15 * 24 * 60 * 60 * 1000))).toBe(false);
    expect(canPost(after, new Date(T0.getTime() + 15 * 24 * 60 * 60 * 1000)).ok).toBe(true);
  });

  it("the public account payload only exposes a suspended boolean, never the expiry or reason", () => {
    const db = createMemoryStore();
    const rec = runner(db);
    suspendAccount(db, ownerCtx(db, "harassment"), rec.id, null, T0);
    const pub = toPublicAccount(db.getAccount(rec.id)!, false, T0);
    expect(pub.suspended).toBe(true);
    const json = JSON.stringify(pub);
    expect(json).not.toContain("suspendedUntil");
    expect(json).not.toContain("suspensionReason");
    expect(json).not.toContain("harassment");
  });

  it("lift clears the suspension and is audited", () => {
    const db = createMemoryStore();
    const rec = runner(db);
    suspendAccount(db, ownerCtx(db, "timeout"), rec.id, 7, T0);
    const r = liftSuspension(db, ownerCtx(db, "apology accepted"), rec.id, T0);
    expect(r.ok).toBe(true);
    const after = db.getAccount(rec.id)!;
    expect(after.suspendedUntil).toBeNull();
    expect(after.suspensionReason).toBeNull();
    expect(isSuspended(after, T0)).toBe(false);
    expect(db.listAudit(10).some((a) => a.action === "admin.unsuspend")).toBe(true);
  });

  it("invalid expiry values are rejected", () => {
    const db = createMemoryStore();
    const rec = runner(db);
    const zero = suspendAccount(db, ownerCtx(db), rec.id, 0, T0);
    expect(zero.ok).toBe(false);
    if (!zero.ok) expect(zero.error).toBe("invalid_expiry");
    const tooLong = suspendAccount(db, ownerCtx(db), rec.id, 366, T0);
    expect(tooLong.ok).toBe(false);
    if (!tooLong.ok) expect(tooLong.error).toBe("invalid_expiry");
    expect(isSuspended(db.getAccount(rec.id)!, T0)).toBe(false);
  });

  it("lifting a non-suspended account is rejected", () => {
    const db = createMemoryStore();
    const rec = runner(db);
    const r = liftSuspension(db, ownerCtx(db), rec.id, T0);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("not_suspended");
  });
});

describe("RRCA badge notes", () => {
  beforeEach(() => {
    process.env[ADMIN_KEY_VAR] = KEY;
  });
  afterEach(() => {
    delete process.env[ADMIN_KEY_VAR];
  });

  it("owner can set badge + internal note; public state carries only the badge", () => {
    const db = createMemoryStore();
    seedContentRegistry(db);
    const r = setGroupRrca(db, ownerCtx(db, "charter verified on rrca.org"), "ctc", { badge: true, note: "Charter #12345, verified 2026-08-01" }, T0);
    expect(r.ok).toBe(true);
    const group = db.getGroup("ctc")!;
    expect(group.rrcaBadge).toBe(true);
    expect(group.rrcaNote).toBe("Charter #12345, verified 2026-08-01");
    expect(db.listAudit(10).some((a) => a.action === "admin.group_rrca" && a.targetId === "ctc")).toBe(true);
    const pub = publicModerated(db, CITY);
    const ctc = pub.groups.find((g) => g.id === "ctc")!;
    expect(ctc.rrcaBadge).toBe(true);
    expect(JSON.stringify(pub)).not.toContain("Charter #12345");
  });

  it("badge off drops the public RRCA label", () => {
    const db = createMemoryStore();
    seedContentRegistry(db);
    const r = setGroupRrca(db, ownerCtx(db, "charter lapsed"), "ctc", { badge: false }, T0);
    expect(r.ok).toBe(true);
    expect(publicModerated(db, CITY).groups.find((g) => g.id === "ctc")!.rrcaBadge).toBe(false);
  });

  it("unknown group is rejected", () => {
    const db = createMemoryStore();
    const r = setGroupRrca(db, ownerCtx(db), "nope", { badge: true }, T0);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("not_found");
  });
});

describe("featured / pinned highlights", () => {
  beforeEach(() => {
    process.env[ADMIN_KEY_VAR] = KEY;
  });
  afterEach(() => {
    delete process.env[ADMIN_KEY_VAR];
  });

  it("featured and pinned are independent toggles for events and races", () => {
    const db = createMemoryStore();
    seedContentRegistry(db);
    const feat = setContentHighlight(db, ownerCtx(db, "promoting this week"), "event:sat-long", { featured: true }, T0);
    expect(feat.ok).toBe(true);
    const pin = setContentHighlight(db, ownerCtx(db, "sticky race"), "race:r1", { pinned: true }, T0);
    expect(pin.ok).toBe(true);
    const pub = publicModerated(db, CITY);
    const ev = pub.highlights.find((h) => h.id === "event:sat-long")!;
    expect(ev.featured).toBe(true);
    expect(ev.pinned).toBe(false);
    const rc = pub.highlights.find((h) => h.id === "race:r1")!;
    expect(rc.pinned).toBe(true);
    expect(rc.featured).toBe(false);
    expect(db.listAudit(10).filter((a) => a.action === "admin.content_highlight")).toHaveLength(2);
  });

  it("a content_highlight audit entry targets the content id", () => {
    const db = createMemoryStore();
    seedContentRegistry(db);
    setContentHighlight(db, ownerCtx(db, "promoting"), "event:tue-track", { featured: true }, T0);
    const audit = db.listAudit(10).find((a) => a.action === "admin.content_highlight")!;
    expect(audit.targetId).toBe("event:tue-track");
  });

  it("forum posts cannot be featured/pinned through this action", () => {
    const db = createMemoryStore();
    seedContentRegistry(db);
    const r = setContentHighlight(db, ownerCtx(db), "post:p4", { featured: true }, T0);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("invalid_kind");
  });
});

describe("dashboard payload safety", () => {
  beforeEach(() => {
    process.env[ADMIN_KEY_VAR] = KEY;
  });
  afterEach(() => {
    delete process.env[ADMIN_KEY_VAR];
  });

  it("dashboard overview never contains phone, selfie, IP, or Supabase identity data", () => {
    const db = createMemoryStore();
    seedContentRegistry(db);
    seedSampleFlags(db, T0);
    // A suspended account with heavy sensitive fields must stay redacted.
    const rec = db.createAccount({ name: "Trouble", email: "trouble@example.com" });
    db.updateAccount(rec.id, {
      phone: "+15735550123",
      selfieRef: `${rec.id}_selfie.jpg`,
      signupIp: "203.0.113.9",
      loginIps: [{ ip: "203.0.113.9", at: "2026-08-01T00:00:00.000Z" }],
      supabaseAuthId: "11111111-2222-3333-4444-555555555555",
      suspended: true,
      suspendedUntil: null,
      suspensionReason: "harassment",
    });
    const r = dashboardOverview(db, ownerCtx(db), CITY, T0);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.suspensions.some((s) => s.accountId === rec.id)).toBe(true);
      const json = JSON.stringify(r.data);
      for (const forbidden of ["573555", "+15735550123", "selfie", "signupIp", "loginIps", "203.0.113.9", "supabase", "11111111-2222-3333-4444-555555555555"]) {
        expect(json).not.toContain(forbidden);
      }
      expect(json).toContain("harassment"); // the moderation reason IS the point of the row
    }
  });

  it("the public moderated payload exposes visibility facts only — no reasons or reporters", () => {
    const db = createMemoryStore();
    seedContentRegistry(db);
    seedSampleFlags(db, T0);
    const pub = publicModerated(db, CITY);
    expect(Array.isArray(pub.hidden)).toBe(true);
    expect(Array.isArray(pub.highlights)).toBe(true);
    expect(Array.isArray(pub.groups)).toBe(true);
    const json = JSON.stringify(pub);
    expect(json).not.toContain("reason");
    expect(json).not.toContain("reporter");
    expect(json).not.toContain("Sample report");
  });
});

describe("moderation registry seeding", () => {
  it("mirrors all seeded Columbia content and groups, idempotently, preserving owner state", () => {
    const db = createMemoryStore();
    seedContentRegistry(db);
    const events = db.listContent().filter((c) => c.kind === "event");
    const races = db.listContent().filter((c) => c.kind === "race");
    const posts = db.listContent().filter((c) => c.kind === "post");
    expect(events.length).toBeGreaterThanOrEqual(6);
    expect(races.length).toBeGreaterThanOrEqual(3);
    expect(posts.length).toBeGreaterThanOrEqual(8);
    expect(db.listGroups().some((g) => g.id === "ctc" && g.rrcaBadge === true)).toBe(true);
    expect(db.listGroups().some((g) => g.id === "runcomo" && g.rrcaBadge === false)).toBe(true);
    // Owner hides something, then re-seeds: the decision must survive.
    const ev = db.getContent("event:mon-social")!;
    db.upsertContent({ ...ev, hidden: true, hiddenAt: T0.toISOString() });
    seedContentRegistry(db);
    expect(db.getContent("event:mon-social")!.hidden).toBe(true);
  });

  it("seeds labeled sample flags only once", () => {
    const db = createMemoryStore();
    seedContentRegistry(db);
    seedSampleFlags(db, T0);
    const count = db.listFlags().length;
    expect(count).toBeGreaterThan(0);
    expect(db.listFlags().every((f) => f.reporterName.startsWith("Sample report"))).toBe(true);
    seedSampleFlags(db, T0);
    expect(db.listFlags().length).toBe(count);
  });

  it("sample flags reference real seeded content", () => {
    const db = createMemoryStore();
    seedContentRegistry(db);
    seedSampleFlags(db, T0);
    for (const f of db.listFlags()) {
      const content = db.getContent(f.contentId);
      expect(content).toBeDefined();
      expect(f.reason).toContain("Sample report (preview data)");
    }
  });
});
