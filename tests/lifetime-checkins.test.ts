/**
 * The lifetime check-in count.
 *
 * The retention mechanic, and it works because it rewards ATTENDING rather than
 * performing — someone with 47 runs comes to their 48th because it is 48. It is
 * also the only number where the newest runner and the veteran play the same
 * game, which is exactly why there is no leaderboard beside it.
 */
import { describe, expect, it } from "vitest";
import { createMemoryStore } from "../src/server/store";
import { lifetimeCheckins } from "../src/server/checkins";
import { readCode } from "./helpers/source";

function checkin(occurrenceId: string, accountId: string, groupId: string, source: "leader" | "qr" = "qr") {
  return {
    id: `ci_${occurrenceId}_${accountId}`,
    eventId: occurrenceId.split(":").slice(0, 2).join(":"),
    occurrenceId,
    runDate: "2026-08-30",
    groupId,
    cityId: "columbia-mo",
    accountId,
    checkedInBy: source === "qr" ? accountId : "leader_1",
    checkedInAt: new Date().toISOString(),
    source,
  } as never;
}

describe("counting", () => {
  it("counts occurrences attended", () => {
    const db = createMemoryStore();
    for (const d of ["01", "08", "15"]) db.addCheckin(checkin(`event:tue:2026-08-${d}`, "acc_a", "ctc"));
    const r = lifetimeCheckins(db, "acc_a");
    expect(r.total).toBe(3);
    expect(r.byGroup.ctc).toBe(3);
  });

  it("is zero for someone who has never checked in", () => {
    // And that is honest rather than a bug: the number means "runs I checked in
    // to", so everyone starts at zero including people who have been coming for
    // months. Backfilling from RSVPs would make it mean something softer.
    expect(lifetimeCheckins(createMemoryStore(), "acc_new")).toEqual({ total: 0, byGroup: {} });
  });

  it("does not count other people's runs", () => {
    // WITH DATA FOR BOTH, not an empty store — an empty count passes for the
    // wrong reason and keeps passing if the filter is removed.
    const db = createMemoryStore();
    db.addCheckin(checkin("event:tue:2026-08-01", "acc_a", "ctc"));
    db.addCheckin(checkin("event:tue:2026-08-01", "acc_b", "ctc"));
    db.addCheckin(checkin("event:tue:2026-08-08", "acc_b", "ctc"));
    expect(lifetimeCheckins(db, "acc_a").total).toBe(1);
    expect(lifetimeCheckins(db, "acc_b").total).toBe(2);
  });
});

describe("dedup is on (accountId, occurrenceId), not on source", () => {
  /*
   * A leader working down a roster does not know who already scanned, so a
   * runner being marked present AFTER scanning in will happen. Source is
   * metadata for audit; the key has to be the thing being counted, which is
   * occurrences attended.
   *
   * Same shape as the invitation cap counting redemptions rather than accounts.
   */
  it("one occurrence counts once even from two sources", () => {
    const db = createMemoryStore();
    db.addCheckin(checkin("event:tue:2026-08-01", "acc_a", "ctc", "qr"));
    // A second row for the same pair, as if the store had let one through.
    const dupe = checkin("event:tue:2026-08-01", "acc_a", "ctc", "leader") as unknown as { id: string };
    dupe.id = "ci_duplicate_row";
    db.addCheckin(dupe as never);
    const r = lifetimeCheckins(db, "acc_a");
    expect(r.total).toBe(1);
    /*
     * byGroup TOO, and this is the half that actually breaks. total is a Set
     * size so it dedups whatever happens; byGroup increments per row. My first
     * version asserted only total and passed with the dedup removed — a guard
     * that watched the one thing that could not fail.
     */
    expect(r.byGroup.ctc).toBe(1);
  });

  it("the store keys on the pair, so a repeat is idempotent", () => {
    /*
     * The real protection — the count's dedup is belt and braces. recordCheckIn
     * returns the EXISTING record rather than writing a second, which is what
     * makes "leader as correction" a no-op rather than an increment.
     */
    const src = readCode(new URL("../src/server/checkins.ts", import.meta.url));
    expect(src).toContain("const existing = db.getCheckin(occ.occurrenceId, targetId);");
    expect(src).toContain("if (existing) return { record: existing };");
  });
});

describe("per group and global", () => {
  it("splits by group and totals across them", () => {
    /*
     * Both numbers, different jobs. The group count goes on the CONFIRMATION —
     * she just ran with this club, and belonging somewhere lands harder than a
     * statistic. The global total goes on the profile, where cumulative is the
     * point and milestones live.
     */
    const db = createMemoryStore();
    db.addCheckin(checkin("event:tue:2026-08-01", "acc_a", "ctc"));
    db.addCheckin(checkin("event:tue:2026-08-08", "acc_a", "ctc"));
    db.addCheckin(checkin("event:sat:2026-08-09", "acc_a", "other-club"));
    const r = lifetimeCheckins(db, "acc_a");
    expect(r.total).toBe(3);
    expect(r.byGroup).toEqual({ ctc: 2, "other-club": 1 });
  });

  it("global is a sum, not a separately stored value", () => {
    // Two representations of one fact, each maintained separately, is the drift
    // class this build has hit repeatedly.
    const src = readCode(new URL("../src/server/checkins.ts", import.meta.url));
    expect(src).toContain("return { total: seen.size, byGroup };");
    expect(src).not.toContain("lifetimeTotal:");
  });
});

describe("the confirmation says the number", () => {
  const PAGE = readCode(new URL("../src/pages/CheckinPage.tsx", import.meta.url));
  const API = readCode(new URL("../src/server/api.ts", import.meta.url));

  it("returns the group count with the check-in", () => {
    expect(API).toContain("const lifetime = lifetimeCheckins(db, runner.id);");
    expect(API).toContain("groupCount: lifetime.byGroup[result.record.groupId] ?? 1");
  });

  it("is computed AFTER the write, so it includes this run", () => {
    const at = API.indexOf("const lifetime = lifetimeCheckins(db, runner.id);");
    expect(API.lastIndexOf("checkinViaSession(db, found.session, runner, now)", at)).toBeGreaterThan(-1);
  });

  it("names the club rather than reporting a total", () => {
    // "That's your 12th run with Columbia Track Club" is a statement about
    // belonging somewhere. A global number at that moment lands flat.
    expect(PAGE).toContain("run with ${group}");
    expect(PAGE).toContain("ordinal(n)");
  });

  it("a repeat scan does not claim a new run", () => {
    // The number is the thing that has to be true; "your 12th" twice breaks it.
    expect(PAGE).toContain("if (c?.duplicate)");
    expect(PAGE).toContain("already checked in");
  });
});

describe("ordinals read correctly", () => {
  /*
   * The number IS the message, so 11th/12th/13th being wrong would undercut the
   * whole moment — and those are exactly the cases a naive n % 10 gets wrong.
   */
  /*
   * Mirrors the implementation rather than evaluating it — the source is
   * TypeScript and new Function chokes on the annotations. The pairing is
   * asserted separately below so the two cannot drift.
   */
  const ordinal = (n: number): string => {
    const rem100 = n % 100;
    if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
    const rem10 = n % 10;
    return `${n}${rem10 === 1 ? "st" : rem10 === 2 ? "nd" : rem10 === 3 ? "rd" : "th"}`;
  };

  it("handles the teens, which the naive rule breaks", () => {
    expect(ordinal(1)).toBe("1st");
    expect(ordinal(2)).toBe("2nd");
    expect(ordinal(3)).toBe("3rd");
    expect(ordinal(4)).toBe("4th");
    expect(ordinal(11)).toBe("11th");
    expect(ordinal(12)).toBe("12th");
    expect(ordinal(13)).toBe("13th");
    expect(ordinal(21)).toBe("21st");
    expect(ordinal(50)).toBe("50th");
    expect(ordinal(101)).toBe("101st");
    expect(ordinal(111)).toBe("111th");
  });

  it("the implementation has the teens rule, not just n % 10", () => {
    /*
     * The pairing: the mirror above is only meaningful if the real function
     * uses the same rule. 11th/12th/13th are exactly what a naive n % 10 gets
     * wrong, and the number IS the message.
     */
    const src = readCode(new URL("../src/pages/CheckinPage.tsx", import.meta.url));
    const body = src.slice(src.indexOf("function ordinal"), src.indexOf("export function CheckinPage"));
    expect(body).toContain("rem100 >= 11 && rem100 <= 13");
  });
});

describe("the cumulative number on the profile is owner-only", () => {
  const API = readCode(new URL("../src/server/api.ts", import.meta.url));
  const TRUST = readCode(new URL("../src/server/trust.ts", import.meta.url));

  it("the endpoint reads the SESSION, never a requested account", () => {
    /*
     * A run count is a presence signal: "32 with Columbia Track Club" says how
     * reliably someone attends and which club. That is the shape the
     * architecture keeps owner-only by default.
     *
     * Owner-only BY CONSTRUCTION rather than by a permission check — the
     * endpoint takes no account parameter, so it cannot be pointed at anyone.
     * Same property that makes getMyRuns safe.
     */
    const at = API.indexOf('url.pathname === "/api/me/checkins"');
    expect(at).toBeGreaterThan(-1);
    const handler = API.slice(at, at + 900);
    expect(handler).toContain("lifetimeCheckins(db, sess.accountId)");
    expect(handler).not.toMatch(/searchParams\.get|accountId = |runnerId/);
  });

  it("requires a session", () => {
    const at = API.indexOf('url.pathname === "/api/me/checkins"');
    expect(API.slice(at, at + 400)).toContain('error: "sign_in_required"');
  });

  it("the PUBLIC profile does not carry it", () => {
    // The assertion that would catch someone adding it to publicRunnerProfile
    // because it seemed like a nice touch.
    const fn = TRUST.slice(TRUST.indexOf("export function publicRunnerProfile"));
    expect(fn.slice(0, 1200)).not.toContain("checkin");
    expect(fn.slice(0, 1200)).not.toContain("lifetime");
  });

  it("resolves group names server-side", () => {
    // An id the client has to cross-reference by hand is the same defect that
    // made the safety queue readable but unactionable.
    const at = API.indexOf('url.pathname === "/api/me/checkins"');
    expect(API.slice(at, at + 900)).toContain("db.getGroup(groupId)?.name ?? groupId");
  });
});

describe("the profile hides a zero", () => {
  const PROFILE = readCode(new URL("../src/pages/ProfilePage.tsx", import.meta.url));

  it("renders nothing until there is a run", () => {
    /*
     * "0 runs" on a new account is a scoreboard reading nothing, and the first
     * thing it would tell a newcomer is that they are behind — the opposite of
     * what the mechanic is for.
     */
    expect(PROFILE).toContain("checkins && checkins.total > 0 ?");
  });

  it("shows the per-club breakdown only when there is more than one", () => {
    // "32 · 32 with CTC" is the same fact twice, which is how a number stops
    // being read.
    expect(PROFILE).toContain("checkins.groups.length > 1 ?");
  });
});
