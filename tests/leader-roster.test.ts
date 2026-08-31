/**
 * A club leader can see who is in their club.
 *
 * They could not. GroupManagePage rendered approve and decline for PENDING
 * requests and nothing else — table stakes for the group product, and
 * separately the thing that made "removing him is the club's decision"
 * unusable, because the club had no surface on which to decide anything.
 */
import { describe, expect, it } from "vitest";
import { readCode } from "./helpers/source";

const LEADERSHIP = readCode(new URL("../src/server/leadership.ts", import.meta.url));
const API = readCode(new URL("../src/server/api.ts", import.meta.url));
const PAGE = readCode(new URL("../src/pages/GroupManagePage.tsx", import.meta.url));
const SAFETY = readCode(new URL("../src/components/SafetyActions.tsx", import.meta.url));

describe("the roster exists and is reachable", () => {
  it("server, endpoint and UI all present", () => {
    // All three, because two out of three is the pattern this codebase keeps
    // producing — the eighth instance is the one I most wanted to avoid adding.
    expect(LEADERSHIP).toContain("export function groupRoster");
    expect(API).toContain("groupRoster(db,actor)");
    expect(PAGE).toContain("api.getLeaderRoster()");
    expect(PAGE).toContain("Remove");
  });

  it("returns only ACTIVE members of groups you actually lead", () => {
    const fn = LEADERSHIP.slice(LEADERSHIP.indexOf("export function groupRoster"));
    expect(fn).toContain("listLedGroups(db, actor)");
    expect(fn).toContain('m.status === "active"');
    // Leading nothing returns nothing rather than everything.
    expect(fn).toContain("if (managed.length === 0) return [];");
  });

  it("is NOT filtered through hiddenFrom", () => {
    /*
     * Deliberate, and the opposite of every other identity list. A lead who has
     * blocked someone still needs to see them in their own roster — that is the
     * surface on which they would act. Hiding a member from the person
     * responsible for the group would protect nobody and break the club.
     */
    const fn = LEADERSHIP.slice(LEADERSHIP.indexOf("export function groupRoster"));
    expect(fn).not.toContain("hiddenFrom");
  });

  it("keeps a deleted account's row", () => {
    // The count stays honest and the history survives — same reasoning as
    // suspension being a status rather than a deletion.
    const fn = LEADERSHIP.slice(LEADERSHIP.indexOf("export function groupRoster"));
    expect(fn).toContain('"Former member"');
  });
});

describe("removal is deliberate and audited", () => {
  it("leads cannot be removed from this surface", () => {
    /*
     * Removing a leader is an ownership act with its own path and its own
     * consequences. Offering it beside ordinary removal invites doing it by
     * accident.
     */
    expect(PAGE).toContain("{m.isLead ? null : (");
  });

  it("requires a reason before the button enables", () => {
    // Removal is on the audited side, and "why" is what anyone reviewing this
    // later will need.
    expect(PAGE).toContain("disabled={removeReason.trim().length < 5}");
  });
});

describe("the removed person is told", () => {
  it("gets a notification naming the group", () => {
    /*
     * Being removed from a club you thought you were in and finding out by
     * ABSENCE — noticing the runs stopped appearing — is worse than being told,
     * and invites assuming a bug.
     *
     * Deliberately unlike a block, where silence is the entire point. A block
     * hides one person from another; a removal is a group acting, and a group
     * that acts should say so.
     */
    const at = API.indexOf("You were removed from");
    expect(at).toBeGreaterThan(-1);
    expect(API.slice(Math.max(0, at - 500), at + 400)).toContain("db.addNotification(");
  });

  it("does not relay the leader's reason", () => {
    // It is in the audit trail for review. A removal message is not the place
    // to pass on whatever someone typed in the moment.
    const at = API.indexOf("You were removed from");
    expect(API.slice(at, at + 500)).not.toContain("reason");
  });

  it("is not sent when they left of their own accord", () => {
    // They know.
    const at = API.indexOf("You were removed from");
    expect(API.slice(Math.max(0, at - 300), at)).toContain('membershipAction[2] === "remove" && targetId !== sess.accountId');
  });
});

describe("the panel's third option is now true", () => {
  it("tells her she can ask a lead", () => {
    // Held back until a lead could actually act. That is now the case.
    expect(SAFETY).toContain("ask a group lead to");
  });
});
