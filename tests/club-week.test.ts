/**
 * Home shows the club, not just the account.
 *
 * It was three first-person panels — your next run, your notifications, your
 * training week — which tells you about your account and nothing about the
 * community you joined. This is not a feed: it is an aggregate with your
 * participation in it.
 */
import { describe, expect, it } from "vitest";
import { createMemoryStore } from "../src/server/store";
import { clubWeek } from "../src/server/clubWeek";
import { readCode } from "./helpers/source";

const SRC = readCode(new URL("../src/server/clubWeek.ts", import.meta.url));
const API = readCode(new URL("../src/server/api.ts", import.meta.url));
const HOME = readCode(new URL("../src/pages/HomePage.tsx", import.meta.url));

/** A Wednesday, so a Monday/Tuesday event has already happened this week. */
const WED = new Date("2026-09-02T12:00:00");

function fixture() {
  const db = createMemoryStore();
  const me = db.createAccount({ name: "Me", email: "me@x.com", cityId: "columbia-mo" });
  const other = db.createAccount({ name: "Other", email: "o@x.com", cityId: "columbia-mo" });
  db.upsertGroup({ id: "ctc", name: "Columbia Track Club", cityId: "columbia-mo", ownerId: me.id } as never);
  db.addMembership({
    id: "m_me", groupId: "ctc", accountId: me.id, cityId: "columbia-mo",
    status: "active", requestedAt: new Date().toISOString(),
  } as never);
  // Tuesday (2) and Wednesday (3) — both on or before the Wednesday clock.
  db.setEvent({ id: "ev_tue", groupId: "ctc", cityId: "columbia-mo", title: "Tuesday", dayOfWeek: 2 } as never);
  db.setEvent({ id: "ev_wed", groupId: "ctc", cityId: "columbia-mo", title: "Wednesday", dayOfWeek: 3 } as never);
  return { db, me, other };
}

describe("the club's number comes from the schedule", () => {
  it("counts occurrences held this week", () => {
    const { db, me } = fixture();
    const rows = clubWeek(db, me.id, WED);
    expect(rows).toHaveLength(1);
    expect(rows[0].groupName).toBe("Columbia Track Club");
    expect(rows[0].runsHeld).toBe(2);
  });

  it("counts a run NOBODY attended", () => {
    /*
     * My first version derived this from attendance rows, which missed any run
     * nobody came to — and the club still held it. The number is about the
     * group's activity, not its popularity.
     */
    const { db, me } = fixture();
    expect(clubWeek(db, me.id, WED)[0].runsHeld).toBe(2); // zero attendance anywhere
  });

  it("does not count a run later today or later this week", () => {
    // "Ran 4 times" about something that has not happened yet is wrong in the
    // one direction that matters.
    const { db, me } = fixture();
    db.setEvent({ id: "ev_sat", groupId: "ctc", cityId: "columbia-mo", title: "Saturday", dayOfWeek: 6 } as never);
    expect(clubWeek(db, me.id, WED)[0].runsHeld).toBe(2);
  });

  it("ignores other groups' events", () => {
    const { db, me } = fixture();
    db.upsertGroup({ id: "other-club", name: "Other Club", cityId: "columbia-mo", ownerId: me.id } as never);
    db.setEvent({ id: "ev_x", groupId: "other-club", cityId: "columbia-mo", title: "X", dayOfWeek: 2 } as never);
    expect(clubWeek(db, me.id, WED)[0].runsHeld).toBe(2);
  });
});

describe("it reads nobody's attendance but your own", () => {
  /*
   * THE SAFETY PROPERTY, and the reason this can ship without the treatment
   * blocking needed. The obvious implementation aggregates other people's
   * attendance — this one does not, because the club's half comes from the
   * schedule and your half comes from you.
   *
   * My first version DID read everyone's attendance and the comment above it
   * claimed otherwise, which is the worst combination: a stated property the
   * code did not have.
   */
  it("only ever queries attendance for the caller", () => {
    // db.listAttendance() with no argument returns everyone's.
    expect(SRC).toContain("db.listAttendance(accountId)");
    expect(SRC).not.toContain("db.listAttendance()");
  });

  it("your count is your own", () => {
    const { db, me, other } = fixture();
    for (const [id, occ] of [[me.id, "ev_tue:2026-09-01"], [other.id, "ev_tue:2026-09-01"], [other.id, "ev_wed:2026-09-02"]] as const) {
      db.addAttendance({ id: `a_${id}_${occ}`, accountId: id, eventId: occ.split(":")[0], occurrenceId: occ, role: "rsvp", createdAt: new Date().toISOString() } as never);
    }
    const rows = clubWeek(db, me.id, WED);
    // Two runs held; I was at one. The other person's two are invisible.
    expect(rows[0].runsHeld).toBe(2);
    expect(rows[0].youWereAt).toBe(1);
  });

  it("the endpoint takes no account parameter", () => {
    // Owner-only by construction, like getMyRuns and the check-in count.
    const at = API.indexOf('url.pathname === "/api/me/club-week"');
    const handler = API.slice(at, at + 500);
    expect(handler).toContain("clubWeek(db, sess.accountId, now)");
    expect(handler).not.toMatch(/searchParams\.get\("account"\)/);
  });
});

describe("membership and empty states", () => {
  it("returns nothing for someone in no groups", () => {
    const db = createMemoryStore();
    const solo = db.createAccount({ name: "Solo", email: "s@x.com", cityId: "columbia-mo" });
    expect(clubWeek(db, solo.id, WED)).toEqual([]);
  });

  it("drops a club that has not run yet this week", () => {
    /*
     * "Columbia Track Club ran 0 times" on a Monday morning is furniture, and
     * it says nothing about the club.
     */
    const { db, me } = fixture();
    const MONDAY = new Date("2026-08-31T08:00:00");
    expect(clubWeek(db, me.id, MONDAY)).toEqual([]);
  });

  it("only counts ACTIVE memberships", () => {
    const { db, me } = fixture();
    db.addMembership({
      id: "m_pending", groupId: "pending-club", accountId: me.id, cityId: "columbia-mo",
      status: "pending", requestedAt: new Date().toISOString(),
    } as never);
    expect(clubWeek(db, me.id, WED).map((r) => r.groupId)).toEqual(["ctc"]);
  });
});

describe("the panel states participation, not a score", () => {
  it("says 'You were at 2', not '2 of 4'", () => {
    /*
     * A ratio invites reading it as something you are failing, which is the
     * competitive framing this product deliberately avoids — the same reason
     * there is no leaderboard beside the lifetime count.
     */
    expect(HOME).toContain("You were at ${c.youWereAt}.");
    expect(HOME).not.toContain("of ${c.runsHeld}");
  });

  it("has a non-zero-shaming empty case", () => {
    // "You were at 0" is a scoreboard. "You haven't been out with them yet this
    // week" is an invitation.
    expect(HOME).toContain("You haven't been out with them yet this week.");
  });

  it("renders nothing when there are no clubs", () => {
    expect(HOME).toContain("clubs.length > 0 ?");
  });
});
