/**
 * What a block does NOT do, told to her at the moment she does it.
 *
 * Two things must be said and there will be a third; separate notices turn a
 * moment that should inform her into a queue she stops reading. So they resolve
 * to ONE panel listing whatever applies.
 */
import { describe, expect, it } from "vitest";
import { createMemoryStore } from "../src/server/store";
import { blockCaveats } from "../src/server/privacy";
import { readCode } from "./helpers/source";

const API = readCode(new URL("../src/server/api.ts", import.meta.url));

describe("caveats are computed for the specific pair", () => {
  it("no shared groups means nothing to say", () => {
    // The common case, and it must stay silent — a panel that always appears is
    // a panel nobody reads.
    const db = createMemoryStore();
    const her = db.createAccount({ name: "Her", email: "h@x.com", cityId: "columbia-mo" });
    const him = db.createAccount({ name: "Him", email: "hm@x.com", cityId: "columbia-mo" });
    expect(blockCaveats(db, her.id, him.id)).toEqual([]);
  });

  it("reports leadership INSTEAD of membership, not alongside it", () => {
    /*
     * A leader is necessarily a member. Reporting both would state the weaker
     * fact twice while burying the one that needs a human.
     */
    const src = readCode(new URL("../src/server/privacy.ts", import.meta.url));
    const at = src.indexOf("export function blockCaveats");
    const fn = src.slice(at, at + 1200);
    expect(fn).toContain('isGroupLead(db, group, blocked) ? "leads_group" : "shared_group"');
  });

  it("only counts ACTIVE memberships on both sides", () => {
    // A pending request is not co-membership, and telling her about one would
    // be wrong in a way that erodes trust in the panel.
    const src = readCode(new URL("../src/server/privacy.ts", import.meta.url));
    const at = src.indexOf("export function blockCaveats");
    const fn = src.slice(at, at + 1200);
    expect(fn).toContain('m.status === "active"');
    expect(fn).toContain('if (m.status !== "active"');
  });
});

describe("delivered in the response, not as a notification", () => {
  it("the block endpoint returns them", () => {
    /*
     * She is standing there having just blocked someone — that is when the
     * information is useful. A notification arriving later reads as "something
     * happened" rather than "here is what you just did".
     */
    expect(API).toContain("const caveats = blockCaveats(db, sess.accountId, param);");
    expect(API).toContain('return ok(res, { status: "blocked", caveats }), true;');
  });

  it("the leader case ALSO escalates to a human", () => {
    // Filtering cannot remove his powers over her content, and that judgement
    // should not be hers alone.
    const at = API.indexOf('caveats.filter((c) => c.kind === "leads_group")');
    expect(at).toBeGreaterThan(-1);
    expect(API.slice(at, at + 900)).toContain("db.addNotification(");
  });

  it("escalation stays a notification, not an email", () => {
    // Not an emergency, and she is entitled to block someone quietly.
    const at = API.indexOf("A member blocked a group leader");
    expect(API.slice(Math.max(0, at - 700), at + 400)).not.toContain("sendEmail(");
  });
});
