/**
 * A new account must be able to hear from us.
 *
 * Three of four channels defaulted OFF with no onboarding step and no prompt.
 * account_alerts:false is the sharpest: that is the channel for "your
 * verification was approved", which is exactly what a new invitee is sitting
 * there waiting for. They verify, they get approved, and they are never told —
 * so the app looks broken at the one moment it should feel like it works.
 *
 * One value in one line silently disabled a whole subsystem.
 */
import { describe, expect, it } from "vitest";
import { createMemoryStore } from "../src/server/store";
import { readCode } from "./helpers/source";

describe("a brand-new account has sane defaults", () => {
  it("account_alerts and run_reminders are ON, community_updates is OFF", () => {
    const db = createMemoryStore();
    const acc = db.createAccount({ name: "New", email: "n@x.com", cityId: "columbia-mo" });
    const prefs = db.getNotificationPreferences(acc.id);
    expect(prefs.account_alerts, "an approved invitee must be told").toBe(true);
    expect(prefs.run_reminders, "highest-retention message an events product has").toBe(true);
    expect(prefs.messages).toBe(true);
    // The one that genuinely is optional.
    expect(prefs.community_updates).toBe(false);
  });
});

describe("account_alerts is transactional, not a preference", () => {
  /*
   * Nobody opts out of being told their verification succeeded, any more than
   * they opt out of a password reset. Offering the toggle implies it is a
   * choice and it is not — so it is pinned on rather than merely defaulted on.
   */
  it("cannot be switched off through the store", () => {
    const db = createMemoryStore();
    const acc = db.createAccount({ name: "New", email: "n2@x.com", cityId: "columbia-mo" });
    // @ts-expect-error deliberately attempting what the type now forbids
    db.setNotificationPreferences(acc.id, { account_alerts: false });
    expect(db.getNotificationPreferences(acc.id).account_alerts).toBe(true);
  });

  it("is absent from the API's allowlist", () => {
    // Type safety stops our own code; the allowlist stops a crafted request.
    const api = readCode(new URL("../src/server/api.ts", import.meta.url));
    const at = api.indexOf('url.pathname === "/api/notifications/preferences"');
    // Window wide enough to clear the explanatory comment before the allowlist.
    const handler = api.slice(at, at + 700);
    expect(handler).toContain('const allowed=["run_reminders","community_updates","messages"]');
    expect(handler).not.toContain('"account_alerts"');
  });

  it("other preferences still change", () => {
    // The pin must not freeze the whole record.
    const db = createMemoryStore();
    const acc = db.createAccount({ name: "New", email: "n3@x.com", cityId: "columbia-mo" });
    db.setNotificationPreferences(acc.id, { run_reminders: false, community_updates: true });
    const prefs = db.getNotificationPreferences(acc.id);
    expect(prefs.run_reminders).toBe(false);
    expect(prefs.community_updates).toBe(true);
    expect(prefs.account_alerts).toBe(true);
  });
});
