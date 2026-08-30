/**
 * Supabase "Confirm email" and the city's status must move together.
 *
 * With confirmation OFF, the only thing standing between a stranger and an
 * account against someone else's address is the invite gate. That is sound
 * while the city is invite_only and unsound the moment it is not.
 *
 * NEITHER SETTING LIVES IN THIS REPO — one is a Supabase dashboard toggle, the
 * other is a row in the store — so no test can read the live values. This is
 * honest about being a REMINDER rather than an enforcement: it asserts the code
 * still assumes the pairing, and that the reasoning is written down where
 * someone changing one will meet it.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("the pairing is recorded where it will be found", () => {
  it("the doc states the rule and the condition that breaks it", () => {
    const doc = readFileSync(new URL("../docs/audit-2026-08/PAIRED-SETTINGS.md", import.meta.url).pathname, "utf8");
    expect(doc).toContain("requires");
    expect(doc).toContain("invite_only");
    expect(doc.toLowerCase()).toContain("confirm email");
  });

  it("the signup path still branches on whether confirmation was required", () => {
    /*
     * The code must keep handling BOTH — if someone deleted the
     * emailConfirmationRequired branch while confirmation is off, turning it
     * back on would silently break every signup, and the pairing would have no
     * code left to protect.
     */
    const login = readFileSync(new URL("../src/pages/LoginPage.tsx", import.meta.url).pathname, "utf8");
    expect(login).toContain("if (r.emailConfirmationRequired) {");
    const sb = readFileSync(new URL("../src/lib/supabase.ts", import.meta.url).pathname, "utf8");
    expect(sb).toContain("emailConfirmationRequired:!data.session");
  });

  it("a resend path exists, since confirmation can be turned back on", () => {
    // When it is on, this is the recovery for a message that never arrived —
    // which is the failure that cost a tester eight days.
    const login = readFileSync(new URL("../src/pages/LoginPage.tsx", import.meta.url).pathname, "utf8");
    expect(login).toContain('to="/confirmation"');
  });
});
