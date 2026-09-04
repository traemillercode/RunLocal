/**
 * A face before your name goes on a list.
 *
 * THE PREMISE CHANGED and it is worth recording which one this rests on. The
 * original argument was "if you require a selfie, the profile photo should be
 * mandatory" — and the selfie has since been demoted to optional, so that
 * conditional no longer holds.
 *
 * The requirement survives for a different and stronger reason: an avatar-less
 * attendee list is impersonal in a product whose whole point is knowing who is
 * going, and default avatars are the "chosen presentation over real identity"
 * position the safety architecture argues for everywhere else.
 */
import { describe, expect, it } from "vitest";
import { AVATAR_STYLES, avatarStyleFor, avatarInitials } from "../src/lib/avatars";
import { readCode } from "./helpers/source";

const API = readCode(new URL("../src/server/api.ts", import.meta.url));
const PICKER = readCode(new URL("../src/components/AvatarPicker.tsx", import.meta.url));
const BOARD = readCode(new URL("../src/components/DepartureBoard.tsx", import.meta.url));

describe("the gate is at the first RSVP, not at signup", () => {
  it("blocks an RSVP when neither a photo nor an avatar is set", () => {
    /*
     * Signup is friction at the worst moment — nobody has seen the product yet
     * and every field is a reason to stop. The first RSVP is when it starts to
     * matter, because that is when your name appears on a list other people
     * read while deciding whether to come.
     */
    const at = API.indexOf('url.pathname === "/api/events/rsvp"');
    const handler = API.slice(at, at + 2000);
    expect(handler).toContain("if (!rec.profilePhotoRef && !rec.avatarStyle)");
    expect(handler).toContain('error: "avatar_required"');
  });

  it("is satisfied by EITHER a photo or an avatar", () => {
    /*
     * Requiring a photograph would push people toward lying or leaving, and on
     * a product that publishes where you will be at dawn, "not my face" is a
     * reasonable position rather than an edge case.
     */
    const at = API.indexOf("if (!rec.profilePhotoRef && !rec.avatarStyle)");
    expect(at).toBeGreaterThan(-1);
    // An AND of absences, not an OR — requiring both would be requiring a photo.
    expect(API.slice(at, at + 60)).toContain("&&");
  });

  it("is not enforced at signup", () => {
    // The account-creation path must stay clear of it.
    const at = API.indexOf('url.pathname === "/api/accounts"');
    expect(API.slice(at, at + 3000)).not.toContain("avatar_required");
  });

  it("says why, not just that", () => {
    // "Required before RSVP" is a policy; "other runners read this list" is the
    // reason, and it is also true.
    const at = API.indexOf('error: "avatar_required"');
    expect(API.slice(at, at + 300)).toContain("other runners read");
  });
});

describe("choosing an avatar", () => {
  it("validates against the known set", () => {
    // An arbitrary string would render as a fallback everywhere and look like a
    // bug rather than a rejected input.
    const at = API.indexOf('url.pathname === "/api/me/avatar"');
    expect(API.slice(at, at + 900)).toContain("AVATAR_STYLES.some((a) => a.id === style)");
  });

  it("sets it for the SESSION account only", () => {
    // Owner-only by construction, like the check-in count: no account parameter.
    const at = API.indexOf('url.pathname === "/api/me/avatar"');
    const handler = API.slice(at, at + 900);
    expect(handler).toContain("db.updateAccount(sess.accountId, { avatarStyle: style })");
    expect(handler).not.toMatch(/searchParams\.get\("account"\)/);
  });

  it("falls back rather than rendering nothing for an unknown id", () => {
    expect(avatarStyleFor("nope").id).toBe(AVATAR_STYLES[0].id);
    expect(avatarStyleFor(null).id).toBe(AVATAR_STYLES[0].id);
    expect(avatarStyleFor("moss").id).toBe("moss");
  });

  it("offers styles distinct enough to tell people apart", () => {
    /*
     * The point of a set is telling people apart on a roster, which a gradient
     * of near-identical blues would not do. Asserted as: no two share a
     * background.
     */
    const backgrounds = AVATAR_STYLES.map((s) => s.bg);
    expect(new Set(backgrounds).size).toBe(backgrounds.length);
    expect(AVATAR_STYLES.length).toBeGreaterThanOrEqual(6);
  });
});

describe("the refusal opens the picker, not a toast", () => {
  it("tags the error so the caller can act on it", () => {
    /*
     * Telling someone what to do without giving them a way to do it is the
     * dead-end pattern this build has removed repeatedly — the FAB's dead link,
     * the pending RSVP button, the safety queue with no subject.
     */
    expect(BOARD).toContain('r.error.code === "avatar_required"');
    expect(BOARD).toContain("setAvatarPromptFor(event.id)");
  });

  it("retries the RSVP after a choice, so the action is not lost", () => {
    // An interruption that loses what you were doing is worse than the one it
    // replaced.
    expect(BOARD).toContain("void createRsvp(occ)");
  });
});

describe("initials", () => {
  it("takes up to two, matching the fallback used elsewhere", () => {
    expect(avatarInitials("Casey Lee")).toBe("CL");
    expect(avatarInitials("Casey")).toBe("C");
    expect(avatarInitials("Casey Ann Lee")).toBe("CA");
    expect(avatarInitials("   ")).toBe("?");
  });

  it("the picker shows a neutral mark when it has no name", () => {
    // A question mark reads as an error state in a grid of choices.
    expect(PICKER).toContain('name.trim() ? avatarInitials(name) : "\\u2022"');
  });
});
