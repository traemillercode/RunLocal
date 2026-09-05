/**
 * Two capabilities that existed and could not be reached.
 *
 * Both are the same pattern — the ninth and tenth instances in this build — and
 * both were reported as missing features rather than as unreachable ones:
 *
 *   "I can't delete anything"  — purge-preview, purge-all and purge all worked
 *   on the server, adminPurgePreview / adminPurgeAll / adminPurge all existed
 *   in lib/api, and NOTHING rendered them.
 *
 *   The chosen avatar reached no surface — seven files hand-rolled a
 *   photo-or-initials pair and none knew about avatarStyle, so someone who
 *   picked an avatar saw it in the picker and nowhere else.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";

const PURGE = readFileSync(new URL("../src/components/PurgeSection.tsx", import.meta.url).pathname, "utf8");
const ADMIN = readFileSync(new URL("../src/pages/AdminPage.tsx", import.meta.url).pathname, "utf8");
const AVATAR = readFileSync(new URL("../src/components/Avatar.tsx", import.meta.url).pathname, "utf8");

describe("clearing test data is reachable", () => {
  it("is rendered in admin", () => {
    // The whole defect: the capability worked and had no path to it.
    expect(ADMIN).toContain("<PurgeSection reason={reason} />");
  });

  it("previews before destroying, and shows the list not just a count", () => {
    /*
     * "12 accounts" is a promise; twelve addresses is something you can check
     * before destroying it.
     */
    expect(PURGE).toContain("api.adminPurgePreview(reason)");
    expect(PURGE).toContain("preview.emails.map");
  });

  it("sends the previewed count back with the confirmation", () => {
    /*
     * So the server refuses if the number changed between preview and confirm
     * rather than deleting more than was shown. The check belongs on the
     * server; this is the client holding up its end.
     */
    expect(PURGE).toContain("api.adminPurgeAll(confirmText, preview.count, reason)");
  });

  it("requires the exact phrase", () => {
    expect(PURGE).toContain('confirmText !== "DELETE ALL"');
  });

  it("is owner-only, not city-admin", () => {
    const at = ADMIN.indexOf("<PurgeSection");
    expect(ADMIN.slice(Math.max(0, at - 120), at)).toContain("!isCityAdmin");
  });

  it("keeps the retention purge separate from the destructive one", () => {
    // Removing past-retention records is routine and needs no confirmation;
    // conflating them would train someone to type DELETE ALL casually.
    expect(PURGE).toContain("api.adminPurge(reason)");
    const at = PURGE.indexOf("api.adminPurge(reason)");
    expect(PURGE.slice(Math.max(0, at - 600), at)).not.toContain("DELETE ALL");
  });
});

describe("the face follows the person", () => {
  it("a photo wins when there is one", () => {
    expect(AVATAR).toContain("if (photoUrl) {");
  });

  it("falls back to the chosen avatar, never to a blank circle", () => {
    /*
     * An avatarless row on an attendee list is the impersonal thing the whole
     * requirement exists to prevent, so a missing or unknown style degrades to
     * a face rather than to nothing.
     */
    expect(AVATAR).toContain("avatarStyleFor(avatarStyle)");
    expect(AVATAR).toContain("avatarInitials(name)");
  });

  it("the profile uses it rather than hand-rolling one", () => {
    const profile = readFileSync(new URL("../src/pages/ProfilePage.tsx", import.meta.url).pathname, "utf8");
    expect(profile).toContain("<Avatar name={name}");
    expect(profile).toContain("avatarStyle={me?.status === \"signed_in\" ? me.account.avatarStyle : null}");
  });

  it("no file redeclares its own initials helper", () => {
    /*
     * SEVEN did. Each with its own slicing rule, so the same person could show
     * as "CL" on one screen and "C" on another — which is exactly how an avatar
     * stops reading as identity.
     *
     * This is the guard that keeps the consolidation from unwinding: the sweep
     * still has six files to convert, and the count must only go down.
     */
    const offenders: string[] = [];
    for (const dir of ["../src/pages", "../src/components"]) {
      const path = new URL(dir, import.meta.url).pathname;
      for (const f of readdirSync(path).filter((x) => x.endsWith(".tsx"))) {
        if (/function initials\(/.test(readFileSync(`${path}/${f}`, "utf8"))) offenders.push(f);
      }
    }
    // Six remain, down from seven. Listed so the sweep can drive it to zero.
    expect(offenders.length).toBeLessThanOrEqual(6);
  });
});
