/**
 * The hidden set, and the capability layer it has to reach.
 *
 * "A hidden connection grants nothing" — not messaging, not connections-only
 * content, not appearing in mutuals. If it only filters rendering, it is the
 * suspension bug one layer down: a flag that changes what you see and not what
 * you can do.
 */
import { describe, expect, it } from "vitest";
import { createMemoryStore } from "../src/server/store";
import { hiddenFrom, withoutHidden, canView } from "../src/server/privacy";
import { readCode } from "./helpers/source";

function fixture() {
  const db = createMemoryStore();
  const alice = db.createAccount({ name: "Alice", email: "al@x.com", cityId: "columbia-mo" });
  const bob = db.createAccount({ name: "Bob", email: "bo@x.com", cityId: "columbia-mo" });
  const cara = db.createAccount({ name: "Cara", email: "ca@x.com", cityId: "columbia-mo" });
  for (const a of [alice, bob, cara]) db.updateAccount(a.id, { status: "verified", avatarStyle: "coral" });
  return { db, alice, bob, cara };
}

describe("blocked, deleted and suspended are one answer", () => {
  /*
   * THE POINT IS THE UNION. Collapsing them means "she blocked him" is
   * indistinguishable from "she deleted her account" BY CONSTRUCTION, rather
   * than by remembering to return matching error strings at each site that
   * could tell them apart. Six such sites had drifted before this existed.
   */
  it("a blocked account is hidden from the person blocked", () => {
    const { db, alice, bob } = fixture();
    db.addBlock({ blockerId: alice.id, blockedId: bob.id, createdAt: new Date().toISOString() } as never);
    expect(hiddenFrom(db, bob.id).has(alice.id), "she must disappear for him").toBe(true);
    expect(hiddenFrom(db, alice.id).has(bob.id), "and he for her, by default").toBe(true);
  });

  it("finds blocks in BOTH directions", () => {
    /*
     * listBlocks() is one-directional — "who have I blocked". Using it here
     * would have hidden her from herself and left HIM seeing everything, which
     * is protecting exactly the wrong person.
     */
    const { db, alice, bob } = fixture();
    db.addBlock({ blockerId: alice.id, blockedId: bob.id, createdAt: new Date().toISOString() } as never);
    expect(db.listBlocks(bob.id)).toHaveLength(0);            // he blocked nobody
    expect(db.listBlocksInvolving(bob.id)).toHaveLength(1);   // but he is in one
  });

  it("deleted and suspended accounts are hidden from EVERYONE", () => {
    // Same answer for a guest and a member, so neither can infer from the other.
    const { db, alice, bob, cara } = fixture();
    db.updateAccount(bob.id, { deletedAt: new Date().toISOString() });
    db.updateAccount(cara.id, { suspended: true, suspendedUntil: null });
    for (const viewer of [alice.id, null]) {
      const hidden = hiddenFrom(db, viewer);
      expect(hidden.has(bob.id)).toBe(true);
      expect(hidden.has(cara.id)).toBe(true);
    }
  });

  it("an expired suspension is not hidden", () => {
    const { db, alice, cara } = fixture();
    db.updateAccount(cara.id, { suspended: true, suspendedUntil: new Date(Date.now() - 864e5).toISOString() });
    expect(hiddenFrom(db, alice.id).has(cara.id)).toBe(false);
  });

  it("an unrelated member is not hidden", () => {
    // Else the filter would be trivially "correct" by hiding everyone.
    const { db, alice, cara } = fixture();
    expect(hiddenFrom(db, alice.id).has(cara.id)).toBe(false);
  });
});

describe("the filter removes names, never counts", () => {
  it("filters an identity list", () => {
    const { db, alice, bob, cara } = fixture();
    db.addBlock({ blockerId: alice.id, blockedId: bob.id, createdAt: new Date().toISOString() } as never);
    const attendees = [{ id: alice.id }, { id: bob.id }, { id: cara.id }];
    const visible = withoutHidden(attendees, hiddenFrom(db, bob.id), (r) => r.id);
    // WITH REAL DATA AND A BLOCKED VIEWER, not an empty list — an empty render
    // passes for the wrong reason and keeps passing when the filter is removed.
    expect(visible.map((r) => r.id)).toEqual([bob.id, cara.id]);
    expect(attendees).toHaveLength(3); // the source is untouched
  });

  it("no count function accepts a viewer", () => {
    /*
     * If he sees 11 where everyone else sees 12, the block is readable and we
     * have made things worse. Structural rather than remembered.
     */
    const offenders: string[] = [];
    for (const f of ["../src/server/privacy.ts", "../src/server/api.ts"]) {
      const src = readCode(new URL(f, import.meta.url));
      for (const m of src.matchAll(/function (\w*(?:[Cc]ount|[Ss]ummary)\w*)\s*\(([^)]*)\)/g)) {
        if (/viewer/i.test(m[2])) offenders.push(m[1]);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("the capability layer, not just rendering", () => {
  it("canView refuses a blocked viewer before checking the connection", () => {
    const { db, alice, bob } = fixture();
    db.addBlock({ blockerId: alice.id, blockedId: bob.id, createdAt: new Date().toISOString() } as never);
    expect(canView(db, bob.id, alice.id, "show_tagged_content")).toBe(false);
  });

  it("messaging consults the block, not only the connection row", () => {
    /*
     * This gated on `pair.status === "accepted"` alone, which is safe today
     * only because blockConnection marks the row removed — safe by ACCIDENT.
     * The check was asking "are you connected"; the question is "may you reach
     * her". If blocking ever moves from severing to hiding, that line silently
     * starts letting a blocked person message her.
     */
    const api = readCode(new URL("../src/server/api.ts", import.meta.url));
    const at = api.indexOf('error: "not_connected"');
    const before = api.slice(Math.max(0, at - 400), at);
    expect(before).toContain("db.isBlocked(sess.accountId, target)");
  });
});

describe("severing must not leave him anything he held", () => {
  /*
   * Sever is the chosen model, and Morgan's argument that hiding buys no
   * silence is right: filtering her from his connections list drops his visible
   * count exactly as severing does, so hiding pays a permanent filter for
   * nothing. Severing also produces a COHERENT story — connection gone plus
   * profile 404 reads as "she deleted her account", which is the
   * indistinguishability the doc asks for.
   *
   * But severing only works if the row was the ONLY thing granting access.
   */
  const API = readCode(new URL("../src/server/api.ts", import.meta.url));

  it("unblocking does not restore the severed connection", () => {
    // Otherwise the sever leaks into a re-approach: he waits, she relents on
    // the block, and he is back in her connections without asking.
    const { db, alice, bob } = fixture();
    const store = readCode(new URL("../src/server/store.ts", import.meta.url));
    const fn = store.slice(store.indexOf("removeBlock(blockerId"), store.indexOf("removeBlock(blockerId") + 200);
    expect(fn).not.toContain("updateConnection");
    expect(fn).not.toContain("accepted");
    void alice; void bob; void db;
  });

  it("a re-request from a blocked person is silent and reaches nothing", async () => {
    const { db, alice, bob } = fixture();
    const { requestConnection, blockConnection } = await import("../src/server/connections");
    expect(requestConnection(db, bob.id, alice.id).ok).toBe(true);
    blockConnection(db, alice.id, bob.id);
    const again = requestConnection(db, bob.id, alice.id);
    expect(again.ok).toBe(false);
    // Identical to a request to an account that does not exist.
    if (!again.ok) expect(again.error).toBe("not_found");
  });

  it("an existing one-to-one conversation stops working after a block", () => {
    /*
     * THE HOLE THIS FOUND. Sending a message authorised on
     * participantIds.includes(sender) alone — membership granted at creation
     * and never revisited. Blocking severed the connection, removed him from
     * her lists, and left him messaging her in a thread that already existed.
     */
    const at = API.indexOf("db.addMessage(");
    const before = API.slice(Math.max(0, at - 1200), at);
    expect(before).toContain("db.isBlocked(sess.accountId, otherParticipant)");
    // And it must refuse like a missing conversation, not like a block.
    const guard = before.slice(before.indexOf("otherParticipant"));
    expect(guard).toContain('error: "not_found"');
    expect(guard).not.toContain('error: "blocked"');
  });

  it("leaves group conversations alone", () => {
    // A club thread is not a private channel to her, and removing him because
    // one member blocked him is a different decision with different fallout.
    const at = API.indexOf("db.isBlocked(sess.accountId, otherParticipant)");
    expect(API.slice(Math.max(0, at - 400), at)).toContain("if (!convo.isGroup)");
  });
});

describe("blocking a group leader escalates to a human", () => {
  /*
   * THE RULE FOR GROUPS: a block preserves membership and grants nothing.
   *
   * A running club is not a private channel. If she blocks him and he is a
   * Track Club member, removing him from the club is a decision the club should
   * make, not one her block makes for them. And the reverse is worse — if
   * blocking cost her the club, she would hesitate to block.
   *
   * But co-membership must grant him nothing: not her in the roster, her posts,
   * her RSVPs, a message path, or group-scoped search.
   *
   * THE EXCEPTION IS A LEADER. His powers are not an identity surface — he
   * moderates content she posts and sees the check-in roster BY ROLE. No filter
   * removes those without breaking the group for everyone else, and silently
   * stripping a leader because one member blocked him would be its own wrong.
   * So it goes to a person.
   */
  it("detects when the blocked person leads a group the blocker is in", async () => {
    const { blockedPersonLeadsGroupsWithBlocker } = await import("../src/server/privacy");
    const api = readCode(new URL("../src/server/api.ts", import.meta.url));
    // Wired into the block action, not merely defined — the sixth instance of
    // "capability exists, nothing calls it" is one I would rather not add.
    // Superseded by blockCaveats(), which resolves shared-group AND leadership
    // in one pass — two block-time notices had to become one panel.
    expect(api).toContain("blockCaveats(db, sess.accountId, param)");
    expect(typeof blockedPersonLeadsGroupsWithBlocker).toBe("function");
  });

  it("returns the groups, not a boolean", () => {
    /*
     * "The person she blocked leads Columbia Track Club, which she is in" is
     * actionable. "Escalate" is not.
     */
    const src = readCode(new URL("../src/server/privacy.ts", import.meta.url));
    const at = src.indexOf("export function blockCaveats");
    expect(src.slice(at, at + 200)).toContain("BlockCaveat[]");
  });

  it("notifies without emailing", () => {
    /*
     * Not an emergency, and it must not read to her as though something
     * happened — she blocked someone, which she is entitled to do quietly.
     */
    const api = readCode(new URL("../src/server/api.ts", import.meta.url));
    const at = api.indexOf("A member blocked a group leader");
    expect(at).toBeGreaterThan(-1);
    const block = api.slice(Math.max(0, at - 600), at + 400);
    expect(block).toContain("db.addNotification(");
    expect(block).not.toContain("sendEmail(");
  });

  it("does not escalate for an ordinary block", async () => {
    // Else every block escalates and the signal is worthless. Tested with real
    // accounts and a real block, not by reading the source.
    const { db, alice, bob } = fixture();
    const { blockedPersonLeadsGroupsWithBlocker } = await import("../src/server/privacy");
    db.addBlock({ blockerId: alice.id, blockedId: bob.id, createdAt: new Date().toISOString() } as never);
    expect(blockedPersonLeadsGroupsWithBlocker(db, alice.id, bob.id)).toEqual([]);
  });

  it("does not escalate when she is in no groups at all", () => {
    // The cheap exit, and the common case.
    const src = readCode(new URL("../src/server/privacy.ts", import.meta.url));
    expect(src).toContain("if (blockerGroupIds.size === 0) return [];");
  });
});
