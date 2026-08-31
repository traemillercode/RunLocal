/**
 * Surfaces 4–6: search, group feed, connections list.
 *
 * WHAT EACH TURNED OUT TO BE — and two of the three are not what the doc says.
 *
 *   search           — DOES NOT EXIST as a member surface. The only search is
 *                      adminSearch, admin-gated. Nothing resolves a name to a
 *                      person for an ordinary member.
 *   group feed       — DOES NOT EXIST. A group's social surface is /chat, a
 *                      group CONVERSATION, which is a different thing with a
 *                      deliberate exemption.
 *   connections list — safe BY CONSTRUCTION, because blockConnection severs the
 *                      row and both list queries filter on connection status.
 */
import { describe, expect, it } from "vitest";
import { createMemoryStore } from "../src/server/store";
import { requestConnection, acceptConnection, blockConnection } from "../src/server/connections";
import { readCode } from "./helpers/source";
import { readFileSync } from "node:fs";

const API = readCode(new URL("../src/server/api.ts", import.meta.url));

describe("surface 4 — search: there isn't one", () => {
  it("no member-facing person search exists", () => {
    /*
     * Predicted to be the worst after the profile, on the reasoning that its
     * whole job is resolving a name to a person. It has no job, because it does
     * not exist — the only search is adminSearch, behind admin auth.
     *
     * Recorded so this is a KNOWN ABSENCE rather than an unchecked assumption.
     * The day someone adds member search, it needs hiddenFrom on day one, and
     * this test is where they will find that out.
     */
    expect(API).not.toContain('url.pathname === "/api/search"');
    // Raw source: readCode strips comments and shifts offsets, and this is a
    // presence check rather than a structural one.
    const rawApi = readFileSync(new URL("../src/server/api.ts", import.meta.url).pathname, "utf8");
    expect(rawApi).toContain("adminSearch(db, ctx, q, now)");
    // The guard lives INSIDE adminSearch, not at the call site — worth
    // asserting where it actually is rather than where I assumed it was.
    const adminSrc = readCode(new URL("../src/server/admin.ts", import.meta.url));
    const fn = adminSrc.slice(adminSrc.indexOf("export function adminSearch"), adminSrc.indexOf("export function adminSearch") + 400);
    expect(fn).toContain("authorizeAdmin");
    expect(fn).toContain("admin.search");
  });

  it("username availability reveals only that a name is taken", () => {
    /*
     * The partial-fix risk: a block that hides the profile while leaving her
     * findable by username. This endpoint answers "is this username taken",
     * which it must in order for signup to work at all — two people cannot hold
     * one username, so it cannot lie.
     *
     * It does not resolve a username to a PERSON: no name, no id, no city,
     * nothing that confirms which account holds it. Guessing her username and
     * seeing "taken" is weak evidence she has an account, and unchanged by
     * blocking — blocking her must not free her username.
     *
     * Named as a residual rather than fixed, because making it lie breaks
     * signup and the leak it closes is smaller than the one it opens.
     */
    const at = API.indexOf('url.pathname === "/api/username/availability"');
    const handler = API.slice(at, at + 500);
    expect(handler).toContain("available:");
    // No identity of any kind leaves this endpoint.
    expect(handler).not.toContain("name:");
    expect(handler).not.toContain("accountId");
  });
});

describe("surface 5 — group feed: there isn't one either", () => {
  it("a group's social surface is a group CONVERSATION", () => {
    /*
     * No prediction was offered for this one, and the reason is that it is not
     * a surface. There is no group post feed; /groups/:id/chat resolves to a
     * group conversation.
     *
     * Which means it is already covered by a DELIBERATE EXEMPTION: the
     * messaging fix excluded group conversations, because a club thread is not
     * a private channel to her and removing him because one member blocked him
     * is a different decision with different fallout.
     *
     * The consequence is worth stating plainly rather than leaving implied:
     * HER POSTS IN A CLUB THREAD REMAIN VISIBLE TO HIM. That follows from the
     * group rule — membership preserved, and a club is not a private channel —
     * but it is the sharpest edge of that rule and deserves a human decision
     * rather than a discovery.
     */
    expect(API).toContain("getOrCreateGroupChat(db, group.id, now)");
    // The exemption is explicit, not accidental.
    expect(API).toContain("if (!convo.isGroup)");
  });
});

describe("surface 6 — connections list: safe by construction", () => {
  it("both parties vanish from each other's list after a block", () => {
    /*
     * Predicted correctly: no filter needed, because blockConnection sets the
     * row to "removed" and both list queries filter on connection status.
     *
     * Recorded as a PROPERTY rather than a claim, the same way the going count
     * was: it is safe because severing is the model AND the queries read
     * status, and a change to either would break it. Tested with real accounts
     * and a real accepted connection, not by reading the source.
     */
    const db = createMemoryStore();
    const her = db.createAccount({ name: "Her", email: "h@x.com", cityId: "columbia-mo" });
    const him = db.createAccount({ name: "Him", email: "hm@x.com", cityId: "columbia-mo" });
    const r = requestConnection(db, him.id, her.id);
    expect(r.ok).toBe(true);
    if (r.ok && r.connection) acceptConnection(db, her.id, r.connection.id);
    expect(db.listAcceptedConnections(her.id)).toHaveLength(1);
    expect(db.listAcceptedConnections(him.id)).toHaveLength(1);

    blockConnection(db, her.id, him.id);
    expect(db.listAcceptedConnections(her.id), "she stops seeing him").toHaveLength(0);
    expect(db.listAcceptedConnections(him.id), "and he stops seeing her").toHaveLength(0);
  });

  it("a pending request also disappears", () => {
    // Blocking mid-request must not leave the request sitting in her inbox.
    const db = createMemoryStore();
    const her = db.createAccount({ name: "Her", email: "h2@x.com", cityId: "columbia-mo" });
    const him = db.createAccount({ name: "Him", email: "hm2@x.com", cityId: "columbia-mo" });
    requestConnection(db, him.id, her.id);
    expect(db.listIncomingRequests(her.id)).toHaveLength(1);
    blockConnection(db, her.id, him.id);
    expect(db.listIncomingRequests(her.id)).toHaveLength(0);
  });
});
