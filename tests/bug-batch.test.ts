/**
 * The bug batch. Four unrelated defects with one thing in common: each told the
 * user something false rather than showing nothing.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { localISODate } from "../src/lib/dates";
import { readCode } from "./helpers/source";

describe("dates are local, not UTC", () => {
  /*
   * `new Date(...).toISOString().slice(0, 10)` LOOKS like "the date" and is
   * not: toISOString serialises to UTC, so in Columbia (UTC-5) the last five
   * hours of every day report as the day before.
   *
   * Home said "Today" for a run that was tomorrow while the detail page said
   * "Tomorrow" — and a runner acts on that, which makes it the one class of bug
   * where being wrong is worse than showing nothing.
   */
  it("reads local calendar parts", () => {
    // 23:30 local on the 30th. toISOString would give the 31st in a positive
    // offset and the 30th in a negative one; localISODate gives the 30th in
    // both, because it is the date the person is standing in.
    const late = new Date(2026, 7, 30, 23, 30, 0);
    expect(localISODate(late)).toBe("2026-08-30");
  });

  it("handles the first hour of a day", () => {
    const early = new Date(2026, 7, 30, 0, 30, 0);
    expect(localISODate(early)).toBe("2026-08-30");
  });

  it("pads single digits", () => {
    expect(localISODate(new Date(2026, 0, 5, 12, 0, 0))).toBe("2026-01-05");
  });

  it("no page derives a calendar date through toISOString", () => {
    /*
     * THE STRUCTURAL FIX. The same wrong idiom appeared in NINE places and I
     * wrote it twice more myself while fixing the first one, which is exactly
     * the drift shape — one idea spelled out separately in every file that
     * needs it.
     *
     * One helper, and this assertion is what keeps it one.
     */
    const dir = new URL("../src/pages", import.meta.url).pathname;
    const offenders: string[] = [];
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".tsx"))) {
      const src = readFileSync(`${dir}/${f}`, "utf8");
      if (src.includes("toISOString().slice(0, 10)")) offenders.push(f);
    }
    expect(offenders).toEqual([]);
  });
});

describe("the pace calculator handles a marathon", () => {
  const PAGE = readCode(new URL("../src/pages/PaceCalculatorPage.tsx", import.meta.url));

  it("has an hours field", () => {
    /*
     * The maths always worked — minutes had no max, so a marathon was
     * enterable as "240". But asking someone to convert 3:58:12 into 238
     * minutes is asking them to do arithmetic to use a calculator, and failing
     * at the half and the full is failing at the two distances people care
     * most about.
     */
    expect(PAGE).toContain("const [hours, setHours] = useState");
    expect(PAGE).toContain('aria-label="Hours"');
  });

  it("includes hours in the total", () => {
    expect(PAGE).toContain("(Number(hours) || 0) * 3600");
  });

  it("keeps minutes unbounded", () => {
    // The two are independent — someone who thinks in minutes can still enter
    // 240, and taking that away would be fixing an input by breaking one.
    const at = PAGE.indexOf("value={minutes}");
    expect(PAGE.slice(Math.max(0, at - 120), at)).not.toContain('max="59"');
  });

  it("labels all three boxes", () => {
    expect(PAGE).toContain("hr : min : sec");
  });
});

describe("the discussion says the real reason", () => {
  const PAGE = readCode(new URL("../src/pages/EventDetailPage.tsx", import.meta.url));

  it("does not claim the run is hidden or archived when it is not", () => {
    /*
     * Two different conditions shared one message and it described the WRONG
     * one: the gate is verified + attending + same city, and the copy talked
     * about the run being unavailable.
     *
     * Telling someone the run is broken when the truth is that they have not
     * joined it sends them looking for a fault that is not there.
     */
    const at = PAGE.indexOf('if (!canView || status === "denied")');
    const branch = PAGE.slice(at, at + 900);
    expect(branch).not.toContain("hidden, archived");
    expect(branch).toContain("Join this run to see the discussion");
  });

  it("offers the action, not just the reason", () => {
    // A gate that names what would open it and then does not offer it is the
    // dead end this build keeps removing.
    const at = PAGE.indexOf('if (!canView || status === "denied")');
    expect(PAGE.slice(at, at + 900)).toContain("Join this run");
  });

  it("keeps the availability wording for the case it actually describes", () => {
    /*
     * AND IT NAMES NO CAUSE EITHER, which is the actual reported bug.
     * discussion_unavailable fires for SIX conditions — missing event,
     * unresolvable occurrence, unresolvable canonical id, unpublished, hidden,
     * archived — and the copy named three. A live run whose occurrence did not
     * resolve was told it had been hidden or archived.
     * The client can observe the outcome and cannot know the cause, so it says
     * the outcome.
     */
    const at = PAGE.indexOf('if (status === "missing")');
    const branch = PAGE.slice(at, at + 600);
    expect(branch).not.toContain("hidden");
    expect(branch).not.toContain("archived");
    expect(branch).toContain("isn’t available right now");
  });
});

describe("the invitation list surfaces what still needs doing", () => {
  /*
   * It filtered by city and sorted newest-first, so a redeemed invite from
   * three weeks ago sat above an unused one from yesterday and the view only
   * ever grew. At ten that is untidy; at fifty the two rows you can act on are
   * lost among the ones you cannot.
   */
  const SRC = readCode(new URL("../src/server/invitations.ts", import.meta.url));
  const UI = readCode(new URL("../src/components/InvitationsAdminSection.tsx", import.meta.url));

  it("puts actionable invitations first", async () => {
    const { createMemoryStore } = await import("../src/server/store");
    const { listInvitations, createInvitation } = await import("../src/server/invitations");
    const { ADMIN_KEY_VAR, ADMIN_EMAIL_VAR, adminLogin } = await import("../src/server/admin");
    const { saveCity } = await import("../src/server/cms");
    process.env[ADMIN_KEY_VAR] = "k";
    process.env[ADMIN_EMAIL_VAR] = "a@x.com";

    const db = createMemoryStore();
    const login = adminLogin(db, "k", "1.1.1.1");
    if (!login.ok) throw new Error("login");
    const ctx = { userSessionId: null, adminSessionId: login.data.sessionId, ip: "1.1.1.1", reason: "test" } as never;
    saveCity(db, ctx, { id: "stl-mo", name: "St. Louis", state: "MO", slug: "stl-mo", status: "invite_only" });

    /*
     * The REDEEMED one is the NEWER one, deliberately. My first fixture had it
     * the other way round, so newest-first and actionable-first produced the
     * same order and the test passed with the sort removed — vacuous, and only
     * caught by putting the old sort back.
     */
    const unused = createInvitation(db, ctx, { cityId: "stl-mo", email: "fresh@x.com" }, new Date("2026-08-01"));
    const redeemed = createInvitation(db, ctx, { cityId: "stl-mo", email: "old@x.com" }, new Date("2026-08-20"));
    if (!unused.ok || !redeemed.ok) throw new Error("create");
    db.updateInvitation(redeemed.data.invitation.id, { usedAt: new Date().toISOString() });

    const rows = listInvitations(db, ctx, "stl-mo", new Date("2026-08-25"));
    if (!rows.ok) throw new Error("list");
    // Unused first even though it is OLDER — which is the whole point.
    expect(rows.data[0].email).toBe("fresh@x.com");
    expect(rows.data[1].email).toBe("old@x.com");
  });

  it("derives state rather than storing it", () => {
    /*
     * usedAt, revokedAt and expiresAt already say everything. A status column
     * would be a fourth representation of the same three facts, and the one
     * that drifts.
     */
    expect(SRC).toContain("!r.usedAt && !r.revokedAt && new Date(r.expiresAt).getTime() > now.getTime()");
  });

  it("hides nothing", () => {
    /*
     * An invitation revoked last week stays findable — "was this address ever
     * invited" is a question worth being able to answer in six months, and it
     * is the reason clearing is a soft-delete elsewhere too.
     */
    const at = SRC.indexOf("const rows = db");
    const block = SRC.slice(at, at + 700);
    expect(block).not.toContain("usedAt)");   // no filter on used
    expect(block).toContain(".filter((i) => !cityId || i.cityId === cityId)");
  });

  it("the divider is computed from the data, not a count", () => {
    // So it stays correct when one is revoked or redeemed, with nothing
    // recalculated.
    expect(UI).toContain("!actionable(i) && (idx === 0 || actionable(rows[idx - 1]))");
  });
});
