import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMemoryStore, Db } from "../src/server/store";
import {
  ADMIN_KEY_VAR,
  ADMIN_EMAIL_VAR,
  type AdminCtx,
} from "../src/server/admin";
import {
  decideSubmission,
  mySubmissions,
  publicApprovedContent,
  submitEvent,
  submitGroup,
  submitRace,
  submissionQueue,
} from "../src/server/submissions";

const KEY = "test-admin-key-123";
const ADMIN_EMAIL = "safety@runlocal.app";
const T0 = new Date("2026-08-03T00:00:00.000Z");

function adminCtx(adminSessionId: string | null, userSessionId?: string | null, reason?: string): AdminCtx {
  return { adminSessionId, userSessionId: userSessionId ?? null, reason, ip: "198.51.100.7" };
}

/** Create a verified runner (status verified). */
function verified(db: Db, email: string, name = "Runner", role: "runner" | "group_leader" = "runner", cityId = "columbia-mo") {
  const rec = db.createAccount({ name, email, cityId });
  db.updateAccount(rec.id, { status: "verified", phase: "pending_review", selfieRef: `${rec.id}_selfie.jpg`, role });
  return rec;
}

const RACE_INPUT = { name: "River 5K", distances: "5K", date: "2026-10-01", location: "Flat Branch", registrationUrl: "https://example.com/r", description: "A 5K along the MKT trail." };
const GROUP_INPUT = { name: "Downtown Runners", description: "A friendly community group.", groupType: "community", facebookUrl: "https://facebook.com/x" };
const EVENT_INPUT = { type: "recurring", title: "Thursday Hills", dayOfWeek: 3, time: "6:00 PM", location: "Grindstone", distanceLabel: "3-5 mi", invite: "Open to all" };

describe("submission permissions", () => {
  beforeEach(() => {
    process.env[ADMIN_KEY_VAR] = KEY;
    process.env[ADMIN_EMAIL_VAR] = ADMIN_EMAIL;
  });
  afterEach(() => {
    delete process.env[ADMIN_KEY_VAR];
    delete process.env[ADMIN_EMAIL_VAR];
  });

  it("guest (no account) is rejected with sign_in_required", () => {
    const db = createMemoryStore();
    const r = submitRace(db, "nonexistent", RACE_INPUT, T0);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("sign_in_required");
  });

  it("pending account cannot submit (verification_required)", () => {
    const db = createMemoryStore();
    const rec = db.createAccount({ name: "P", email: "p@x.com", cityId: "columbia-mo" });
    const r = submitGroup(db, rec.id, GROUP_INPUT, T0);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("verification_required");
  });

  it("suspended verified runner cannot submit", () => {
    const db = createMemoryStore();
    const rec = verified(db, "s@x.com");
    db.updateAccount(rec.id, { suspended: true, suspendedUntil: null });
    const r = submitRace(db, rec.id, RACE_INPUT, T0);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("suspended");
  });

  it("verified runner can submit a race, group, and independent event", () => {
    const db = createMemoryStore();
    const rec = verified(db, "r@x.com", "Rio");
    expect(submitRace(db, rec.id, RACE_INPUT, T0).ok).toBe(true);
    expect(submitGroup(db, rec.id, GROUP_INPUT, T0).ok).toBe(true);
    expect(submitEvent(db, rec.id, EVENT_INPUT, T0).ok).toBe(true);
    expect(db.listSubmissions()).toHaveLength(3);
  });

  it("verified runner without a home city must pass a valid cityId", () => {
    const db = createMemoryStore();
    const rec = verified(db, "r2@x.com");
    db.updateAccount(rec.id, { cityId: null });
    const noCity = submitRace(db, rec.id, RACE_INPUT, T0);
    expect(noCity.ok).toBe(false);
    if (!noCity.ok) expect(noCity.error).toBe("city_required");
    const badCity = submitRace(db, rec.id, { ...RACE_INPUT, cityId: "atlantis-zz" }, T0);
    expect(badCity.ok).toBe(false);
    if (!badCity.ok) expect(badCity.error).toBe("invalid_city");
  });

  it("group leader can submit a race and a group but NOT an independent event", () => {
    const db = createMemoryStore();
    const rec = verified(db, "gl@x.com", "GL", "group_leader");
    expect(submitRace(db, rec.id, RACE_INPUT, T0).ok).toBe(true);
    expect(submitGroup(db, rec.id, GROUP_INPUT, T0).ok).toBe(true);
    const ev = submitEvent(db, rec.id, EVENT_INPUT, T0);
    expect(ev.ok).toBe(false);
    if (!ev.ok) expect(ev.error).toBe("group_leader_independent");
    expect(db.listSubmissions().filter((s) => s.kind === "event")).toHaveLength(0);
  });
});

describe("submission validation", () => {
  it("race rejects missing name, bad date, and non-URL registration", () => {
    const db = createMemoryStore();
    const rec = verified(db, "a@x.com");
    expect((submitRace(db, rec.id, { ...RACE_INPUT, name: "" }, T0) as { ok: false; error: string }).error).toBe("invalid_name");
    expect((submitRace(db, rec.id, { ...RACE_INPUT, date: "01/10/2026" }, T0) as { ok: false; error: string }).error).toBe("invalid_date");
    expect((submitRace(db, rec.id, { ...RACE_INPUT, registrationUrl: "not-a-url" }, T0) as { ok: false; error: string }).error).toBe("invalid_url");
    expect((submitRace(db, rec.id, { ...RACE_INPUT, distances: "" }, T0) as { ok: false; error: string }).error).toBe("invalid_distances");
    expect(submitRace(db, rec.id, RACE_INPUT, T0).ok).toBe(true);
  });

  it("group requires exactly the two allowed group types and valid links", () => {
    const db = createMemoryStore();
    const rec = verified(db, "g@x.com");
    expect((submitGroup(db, rec.id, { ...GROUP_INPUT, groupType: "rrca" }, T0) as { ok: false; error: string }).error).toBe("invalid_group_type");
    expect((submitGroup(db, rec.id, { ...GROUP_INPUT, groupType: "rrca-chartered" }, T0) as { ok: false; error: string }).error).not.toBe("invalid_group_type");
    expect((submitGroup(db, rec.id, { ...GROUP_INPUT, facebookUrl: "facebook.com/x" }, T0) as { ok: false; error: string }).error).toBe("invalid_url");
    expect(submitGroup(db, rec.id, GROUP_INPUT, T0).ok).toBe(true);
  });

  it("independent event validates type, date/day, time, and invite", () => {
    const db = createMemoryStore();
    const rec = verified(db, "e@x.com");
    expect((submitEvent(db, rec.id, { ...EVENT_INPUT, type: "monthly" }, T0) as { ok: false; error: string }).error).toBe("invalid_type");
    // recurring requires dayOfWeek
    expect((submitEvent(db, rec.id, { ...EVENT_INPUT, type: "recurring", dayOfWeek: null }, T0) as { ok: false; error: string }).error).toBe("invalid_day");
    // one_time requires date, ignores dayOfWeek
    expect((submitEvent(db, rec.id, { ...EVENT_INPUT, type: "one_time", dayOfWeek: null, date: "" }, T0) as { ok: false; error: string }).error).toBe("invalid_date");
    expect((submitEvent(db, rec.id, { ...EVENT_INPUT, time: "six pm" }, T0) as { ok: false; error: string }).error).toBe("invalid_time");
    expect((submitEvent(db, rec.id, { ...EVENT_INPUT, invite: "everyone" }, T0) as { ok: false; error: string }).error).toBe("invalid_invite");
    // one_time valid path
    const oneTime = { type: "one_time", title: "Fun Run", date: "2026-09-20", dayOfWeek: null, time: "9:00 AM", location: "Park", distanceLabel: "2 mi", invite: "Open to all" };
    expect(submitEvent(db, rec.id, oneTime, T0).ok).toBe(true);
  });
});

describe("approve / reject transitions", () => {
  beforeEach(() => {
    process.env[ADMIN_KEY_VAR] = KEY;
    process.env[ADMIN_EMAIL_VAR] = ADMIN_EMAIL;
  });
  afterEach(() => {
    delete process.env[ADMIN_KEY_VAR];
    delete process.env[ADMIN_EMAIL_VAR];
  });
  // Use a real admin session via adminLogin.

  it("approving a race creates a public content record and marks approved", async () => {
    const db = createMemoryStore();
    const { adminLogin } = await import("../src/server/admin");
    const login = adminLogin(db, KEY, "198.51.100.7", T0);
    if (!login.ok) throw new Error("login failed");
    const rec = verified(db, "r@x.com");
    const sub = submitRace(db, rec.id, RACE_INPUT, T0);
    if (!sub.ok) throw new Error("submit failed");
    const res = decideSubmission(db, asKeyAdmin(login.data.sessionId, "approving race"), sub.data.id, "approve", T0);
    expect(res.ok).toBe(true);
    const stored = db.getSubmission(sub.data.id)!;
    expect(stored.status).toBe("approved");
    expect(stored.publicRefId).toBe(`user-${sub.data.id}`);
    // moderation registry record created and NOT hidden by default
    expect(db.getContent(`race:user-${sub.data.id}`)).toMatchObject({ kind: "race", title: "River 5K", hidden: false });
    expect(db.listAudit(10).some((a) => a.action === "admin.submission_approve" && a.targetId === sub.data.id)).toBe(true);
  });

  it("approving a group grants the submitter the Group Leader role and never the RRCA badge", async () => {
    const db = createMemoryStore();
    const { adminLogin } = await import("../src/server/admin");
    const login = adminLogin(db, KEY, "198.51.100.7", T0);
    if (!login.ok) throw new Error("login failed");
    const rec = verified(db, "gl@x.com", "GL");
    expect(rec.role).toBe("runner");
    const sub = submitGroup(db, rec.id, { ...GROUP_INPUT, groupType: "rrca-chartered" }, T0);
    if (!sub.ok) throw new Error("submit failed");
    const res = decideSubmission(db, asKeyAdmin(login.data.sessionId, "verifying the club"), sub.data.id, "approve", T0);
    expect(res.ok).toBe(true);
    // Role granted
    expect(db.getAccount(rec.id)!.role).toBe("group_leader");
    // Group record exists, RRCA badge is FALSE (admin-assignable later)
    const grp = db.getGroup(`user-${sub.data.id}`);
    expect(grp).toMatchObject({ name: "Downtown Runners", rrcaBadge: false });
    expect(grp!.rrcaNote).toBeNull();
  });

  it("rejecting stores a required rejection reason and does not publish", async () => {
    const db = createMemoryStore();
    const { adminLogin } = await import("../src/server/admin");
    const login = adminLogin(db, KEY, "198.51.100.7", T0);
    if (!login.ok) throw new Error("login failed");
    const rec = verified(db, "r@x.com");
    const sub = submitEvent(db, rec.id, EVENT_INPUT, T0);
    if (!sub.ok) throw new Error("submit failed");
    const noReason = decideSubmission(db, asKeyAdmin(login.data.sessionId, ""), sub.data.id, "reject", T0);
    expect(noReason.ok).toBe(false);
    if (!noReason.ok) expect(noReason.error).toBe("reason_required");
    const res = decideSubmission(db, asKeyAdmin(login.data.sessionId, "duplicate of an existing run"), sub.data.id, "reject", T0);
    expect(res.ok).toBe(true);
    const stored = db.getSubmission(sub.data.id)!;
    expect(stored.status).toBe("rejected");
    expect(stored.rejectionReason).toBe("duplicate of an existing run");
    // not public
    expect(publicApprovedContent(db, "columbia-mo").events).toHaveLength(0);
    expect(db.listAudit(10).some((a) => a.action === "admin.submission_reject")).toBe(true);
  });

  it("double decisions and unknown ids are rejected", async () => {
    const db = createMemoryStore();
    const { adminLogin } = await import("../src/server/admin");
    const login = adminLogin(db, KEY, "198.51.100.7", T0);
    if (!login.ok) throw new Error("login failed");
    const rec = verified(db, "r@x.com");
    const sub = submitRace(db, rec.id, RACE_INPUT, T0);
    if (!sub.ok) throw new Error("submit failed");
    const ctx = asKeyAdmin(login.data.sessionId, "approve");
    expect(decideSubmission(db, ctx, sub.data.id, "approve", T0).ok).toBe(true);
    const again = decideSubmission(db, ctx, sub.data.id, "reject", T0);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error).toBe("already_decided");
    const missing = decideSubmission(db, ctx, "f".repeat(32), "approve", T0);
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error).toBe("not_found");
  });

  it("approve without a reason header is rejected", async () => {
    const db = createMemoryStore();
    const { adminLogin } = await import("../src/server/admin");
    const login = adminLogin(db, KEY, "198.51.100.7", T0);
    if (!login.ok) throw new Error("login failed");
    const rec = verified(db, "r@x.com");
    const sub = submitRace(db, rec.id, RACE_INPUT, T0);
    if (!sub.ok) throw new Error("submit failed");
    const res = decideSubmission(db, asKeyAdmin(login.data.sessionId, undefined), sub.data.id, "approve", T0);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("reason_required");
  });
});

describe("my submissions (submitter-visible)", () => {
  it("returns only the submitter's own records with statuses and rejection reason", async () => {
    const db = createMemoryStore();
    const { adminLogin } = await import("../src/server/admin");
    process.env[ADMIN_KEY_VAR] = KEY;
    process.env[ADMIN_EMAIL_VAR] = ADMIN_EMAIL;
    const login = adminLogin(db, KEY, "198.51.100.7", T0);
    if (!login.ok) throw new Error("login failed");
    const a = verified(db, "a@x.com", "Alice");
    const b = verified(db, "b@x.com", "Bob");
    const subA = submitRace(db, a.id, RACE_INPUT, T0);
    const subB = submitGroup(db, b.id, GROUP_INPUT, T0);
    if (!subA.ok || !subB.ok) throw new Error("submit failed");
    decideSubmission(db, asKeyAdmin(login.data.sessionId, "duplicate listing"), subA.data.id, "reject", T0);
    const mine = mySubmissions(db, a.id);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ kind: "race", status: "rejected", rejectionReason: "duplicate listing" });
    // Bob's own list never sees Alice's submission
    const bobs = mySubmissions(db, b.id);
    expect(bobs).toHaveLength(1);
    expect(bobs[0].id).toBe(subB.data.id);
    delete process.env[ADMIN_KEY_VAR];
    delete process.env[ADMIN_EMAIL_VAR];
  });
});

describe("admin submission queue", () => {
  beforeEach(() => {
    process.env[ADMIN_KEY_VAR] = KEY;
    process.env[ADMIN_EMAIL_VAR] = ADMIN_EMAIL;
  });
  afterEach(() => {
    delete process.env[ADMIN_KEY_VAR];
    delete process.env[ADMIN_EMAIL_VAR];
  });

  it("requires an admin session and a reason, and returns safe summaries", async () => {
    const db = createMemoryStore();
    const rec = verified(db, "r@x.com", "Rio");
    const sub = submitRace(db, rec.id, RACE_INPUT, T0);
    if (!sub.ok) throw new Error("submit failed");
    // no admin session
    const noAuth = submissionQueue(db, adminCtx(null, undefined, "review"), "columbia-mo", T0);
    expect(noAuth.ok).toBe(false);
    if (!noAuth.ok) expect(noAuth.error).toBe("unauthorized");
    // authenticated but no reason
    const { adminLogin } = await import("../src/server/admin");
    const login = adminLogin(db, KEY, "198.51.100.7", T0);
    if (!login.ok) throw new Error("login failed");
    const noReason = submissionQueue(db, asKeyAdminSafe(login.data.sessionId), "columbia-mo", T0);
    expect(noReason.ok).toBe(false);
    if (!noReason.ok) expect(noReason.error).toBe("reason_required");
    const okRes = submissionQueue(db, asKeyAdminSafe(login.data.sessionId, "queue review"), "columbia-mo", T0);
    expect(okRes.ok).toBe(true);
    if (okRes.ok) {
      expect(okRes.data).toHaveLength(1);
      const row = okRes.data[0];
      expect(row).toMatchObject({ kind: "race", title: "River 5K", submitterName: "Rio", status: "pending" });
      // safe summaries — no email/phone/ip/rejectionReason
      const raw = JSON.stringify(okRes.data);
      expect(raw).not.toContain("x.com");
      expect(raw).not.toContain("rejectionReason");
    }
  });

  it("key-based admin and owner are authorized; a verified runner is not", async () => {
    const db = createMemoryStore();
    const { adminLogin } = await import("../src/server/admin");
    const login = adminLogin(db, KEY, "198.51.100.7", T0);
    if (!login.ok) throw new Error("login failed");
    // owner
    const owner = db.createAccount({ name: "Owner", email: "traemiller.email@gmail.com" });
    const ownerSession = db.createSession(owner.id, "198.51.100.7", T0);
    expect(submissionQueue(db, adminCtx(null, ownerSession.id, "review"), null, T0).ok).toBe(true);
    // verified runner (user session, not owner/admin) is unauthorized
    const runner = verified(db, "v@x.com");
    const runnerSession = db.createSession(runner.id, "198.51.100.7", T0);
    const denied = submissionQueue(db, adminCtx(null, runnerSession.id, "I'm a runner"), null, T0);
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.error).toBe("unauthorized");
  });
});

describe("public approved content", () => {
  beforeEach(() => {
    process.env[ADMIN_KEY_VAR] = KEY;
    process.env[ADMIN_EMAIL_VAR] = ADMIN_EMAIL;
  });
  afterEach(() => {
    delete process.env[ADMIN_KEY_VAR];
    delete process.env[ADMIN_EMAIL_VAR];
  });
  async function approve(db: Db, id: string) {
    const { adminLogin } = await import("../src/server/admin");
    const login = adminLogin(db, KEY, "198.51.100.7", T0);
    if (!login.ok) throw new Error("login failed");
    const r = decideSubmission(db, asKeyAdminSafe(login.data.sessionId, "approve"), id, "approve", T0);
    if (!r.ok) throw new Error("approve failed: " + r.error);
  }

  it("exposes only approved content and hides pending/rejected", async () => {
    const db = createMemoryStore();
    const rec = verified(db, "r@x.com", "Rio");
    const race = submitRace(db, rec.id, RACE_INPUT, T0);
    const ev = submitEvent(db, rec.id, EVENT_INPUT, T0);
    const grp = submitGroup(db, rec.id, GROUP_INPUT, T0);
    if (!race.ok || !ev.ok || !grp.ok) throw new Error("submit");
    // Nothing public yet
    expect(publicApprovedContent(db, "columbia-mo").races).toHaveLength(0);
    await approve(db, race.data.id);
    await approve(db, grp.data.id);
    const pub = publicApprovedContent(db, "columbia-mo");
    expect(pub.races).toHaveLength(1);
    expect(pub.races[0]).toMatchObject({ name: "River 5K", distance: "5K", organizer: "Rio" });
    expect(pub.groups).toHaveLength(1);
    // pending event still hidden
    expect(pub.events).toHaveLength(0);
  });

  it("recurring independent events show the Independent Runner host; hidden content is excluded", async () => {
    const db = createMemoryStore();
    const rec = verified(db, "r2@x.com");
    const race = submitRace(db, rec.id, RACE_INPUT, T0);
    const ev = submitEvent(db, rec.id, EVENT_INPUT, T0);
    if (!race.ok || !ev.ok) throw new Error("submit");
    await approve(db, race.data.id);
    // Hide the approved race via moderation
    const content = db.getContent(`race:user-${race.data.id}`)!;
    db.upsertContent({ ...content, hidden: true, hiddenAt: T0.toISOString() });
    // approve event too
    await approve(db, ev.data.id);
    const pub = publicApprovedContent(db, "columbia-mo");
    expect(pub.races).toHaveLength(0); // hidden
    expect(pub.events).toHaveLength(1);
    expect(pub.events[0]).toMatchObject({ host: "Independent Runner", title: "Thursday Hills", type: "recurring", dayOfWeek: 3 });
    // other cities never see this city's approved content
    expect(publicApprovedContent(db, "stl-mo").races).toHaveLength(0);
  });
});

describe("submission persistence", () => {
  it("round-trips submissions through load/persist", async () => {
    const dir = await mkdtemp(join(tmpdir(), "runlocal-sub-"));
    try {
      const db = new Db({ dataDir: dir });
      await db.load();
      const rec = verified(db, "r@x.com", "Rio");
      const sub = submitRace(db, rec.id, RACE_INPUT, T0);
      if (!sub.ok) throw new Error("submit");
      await db.persist();
      const db2 = new Db({ dataDir: dir });
      await db2.load();
      const loaded = db2.listSubmissions();
      expect(loaded).toHaveLength(1);
      expect(loaded[0]).toMatchObject({ kind: "race", status: "pending", payload: { name: "River 5K" } });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

/** Module-scope helper: a plain key-admin session id ctx (reason optional). */
function asKeyAdminSafe(sessionId: string, reason?: string): AdminCtx {
  return adminCtx(sessionId, undefined, reason);
}
function asKeyAdmin(sessionId: string, reason?: string): AdminCtx {
  return adminCtx(sessionId, undefined, reason);
}
