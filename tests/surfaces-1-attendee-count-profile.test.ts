/**
 * Surfaces 1–3: attendee list, going count, profile.
 *
 * WHAT EACH TURNED OUT TO BE, established before any code:
 *
 *   attendee list — member-only (401 for guests). Returns identities AND an
 *                   aggregate in the same payload. Gated on session alone.
 *   going count   — not a separate surface: the same payload. Derived from
 *                   goingAccountIds.LENGTH while attendees is .slice(0, 4), so
 *                   it was already independent of the names shown.
 *   profile       — reachable by GUESTS. Returns identity. Gated on existence
 *                   and publicRunnerProfile only — NO block check at all.
 */
import { describe, expect, it } from "vitest";
import { createMemoryStore } from "../src/server/store";
import { hiddenFrom, withoutHidden } from "../src/server/privacy";
import { readCode } from "./helpers/source";

const API = readCode(new URL("../src/server/api.ts", import.meta.url));

function fixture() {
  const db = createMemoryStore();
  const her = db.createAccount({ name: "Her", email: "h@x.com", cityId: "columbia-mo" });
  const him = db.createAccount({ name: "Him", email: "hm@x.com", cityId: "columbia-mo" });
  const other = db.createAccount({ name: "Other", email: "o@x.com", cityId: "columbia-mo" });
  for (const a of [her, him, other]) db.updateAccount(a.id, { status: "verified", avatarStyle: "coral" });
  db.addBlock({ blockerId: her.id, blockedId: him.id, createdAt: new Date().toISOString() } as never);
  return { db, her, him, other };
}

describe("surface 3 — profile: it had NO block check", () => {
  it("a blocked viewer gets 404, identical to a profile that does not exist", () => {
    /*
     * The single most valuable page to someone who wants to know about her —
     * name, photo, city, trust tags — and the endpoint refused only for an
     * account that did not exist or was not public.
     */
    const at = API.indexOf("const runnerMatch =");
    const handler = API.slice(at, at + 2200);
    expect(handler).toContain("hiddenFrom(db, viewer?.accountId ?? null).has(rec.id)");
    // Byte-identical to the not_found immediately above it.
    const guard = handler.slice(handler.indexOf("hiddenFrom(db, viewer"));
    expect(guard.slice(0, 200)).toContain('status: 404, error: "not_found"');
  });

  it("uses hiddenFrom, not isBlocked — so deleted and suspended match too", () => {
    // Three conditions producing one response by construction, rather than
    // three places to remember to keep in step.
    const at = API.indexOf("const runnerMatch =");
    expect(API.slice(at, at + 2200)).not.toContain("db.isBlocked(viewerId, rec.id)");
  });
});

describe("surface 1 — attendee list: identities filtered", () => {
  it("removes a hidden person from a real list", () => {
    // WITH DATA AND A BLOCKED VIEWER. An empty list passes for the wrong reason
    // and keeps passing when the filter is removed.
    const { db, her, him, other } = fixture();
    const going = [{ id: her.id }, { id: him.id }, { id: other.id }];
    const visible = withoutHidden(going, hiddenFrom(db, him.id), (r) => r.id);
    expect(visible.map((r) => r.id)).toEqual([him.id, other.id]);
  });

  it("the host goes through the same set", () => {
    // It previously excluded deleted accounts only — a separate condition that
    // had to be kept in step with the others by hand.
    expect(API).toContain("hostAccount && !hidden.has(hostAccount.id)");
  });

  it("resolves the hidden set once per request, not per row", () => {
    // A week's board across 40 attendees would otherwise run 40 lookups, and
    // that cost is what makes people skip the check.
    const at = API.indexOf("const hidden = hiddenFrom(db, s.accountId);");
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(API.indexOf("const byOccurrence"));
  });
});

describe("surface 2 — going count: NOT filtered, deliberately", () => {
  it("derives from the unfiltered list", () => {
    /*
     * THE CONSTRAINT. If he sees 11 where everyone else sees 12, the block is
     * readable and we have made things worse.
     *
     * The existing shape makes this safe rather than delicate: goingCount comes
     * from goingAccountIds.LENGTH and attendees is .slice(0, 4), so the count
     * was already independent of the names. The filter sits after .length is
     * taken and cannot move it.
     */
    expect(API).toContain("goingCount: bucket.goingAccountIds.length");
    // It must not be derived from the filtered array.
    expect(API).not.toContain("goingCount: attendees.length");
    expect(API).not.toContain("goingCount: withoutHidden");
  });

  it("the cap explains the gap, identically whether anyone is hidden", () => {
    /*
     * Fixed-cap arriving for free: 12 going with 4 shown looks the same whether
     * 3 are hidden or 0 are. That is the property the doc asks for, and it
     * holds here because the cap predates the filter.
     */
    expect(API).toContain(".slice(0, 4)");
  });
});
