/**
 * Admin actions that require a reason, and the client/server agreement.
 *
 * THE DEFECT: authorizeAdmin / authorizeOwner / authorizeScoped demanded
 * x-audit-reason unconditionally, while the client sent it on 11 of 75 calls.
 * So 64 admin operations returned 400 reason_required before doing anything —
 * the tool was unusable AND the audit log was empty. Enforced server-side,
 * absent client-side, which is the worst of both.
 */
import { describe, expect, it } from "vitest";
import { reasonRequiredFor } from "../src/server/admin";
import { readCode } from "./helpers/source";

const SERVER = readCode(new URL("../src/server/admin.ts", import.meta.url));

describe("the requirement is per-action, not blanket", () => {
  it("routine actions need no reason", () => {
    // Demanding one here produces a log full of "ok" and teaches operators to
    // type anything to get past it, which devalues the genuine entries.
    for (const action of [
      "admin.approve", "admin.cms_settings", "admin.event_publish",
      "admin.invitation_create", "admin.pending_list", "admin.dashboard",
      "admin.overview", "admin.audit", "admin.search",
    ]) {
      expect(reasonRequiredFor(action)).toBe(false);
    }
  });

  it("destructive and contested actions require one", () => {
    for (const action of [
      "admin.reject", "admin.purge", "admin.suspend", "admin.content_delete",
      "admin.content_hide", "admin.invitation_revoke", "admin.roles_assign",
      "admin.appeal_uphold", "admin.trust_revoke",
    ]) {
      expect(reasonRequiredFor(action)).toBe(true);
    }
  });

  it("rejection requires one because the text is SHOWN to the applicant", () => {
    // Not merely a log line — this reason is user-facing.
    expect(reasonRequiredFor("admin.reject")).toBe(true);
    expect(reasonRequiredFor("admin.submission_reject")).toBe(true);
  });

  it("viewing identity documents is audited even though nothing is written", () => {
    for (const a of ["admin.view_selfie", "admin.view_credential_proof", "admin.export"]) {
      expect(reasonRequiredFor(a)).toBe(true);
    }
  });

  it("an unknown action defaults to NOT required", () => {
    /*
     * Deliberate direction. A capability added tomorrow will not silently break
     * its own UI; it simply is not audited until someone adds it to the set.
     * The old default was the opposite and produced an admin tool that could
     * not be used at all — a worse failure than a missing log entry.
     */
    expect(reasonRequiredFor("admin.something_new")).toBe(false);
  });
});

describe("all three authorize paths honour the split", () => {
  it("every validReason check is gated on the action", () => {
    // Three enforcement points — authorizeAdmin, authorizeOwner,
    // authorizeScoped. One left ungated would keep a third of the tool broken.
    const ungated = SERVER.split("\n").filter(
      (l) => l.includes("!validReason(ctx.reason)") && !l.includes("reasonRequiredFor(action)"),
    );
    expect(ungated).toEqual([]);
    expect(SERVER.split("reasonRequiredFor(action) && !validReason").length - 1).toBe(3);
  });
});

describe("client and server agree", () => {
  const CLIENT = readCode(new URL("../src/lib/api.ts", import.meta.url));

  it("the shared adminRequest helper actually attaches the header", () => {
    /*
     * Checked separately, and this gap is worth recording: the caller test
     * below verifies functions ROUTE THROUGH adminRequest, which passes even if
     * adminRequest itself stops sending the header. Gutting the helper left
     * that test green — every caller still routed correctly to a helper that
     * did nothing. The chokepoint that makes 38 call sites correct is also the
     * single point that can make all 38 wrong.
     */
    const helper = CLIENT.slice(CLIENT.indexOf("function adminRequest"));
    expect(helper.slice(0, 300)).toContain('"x-audit-reason": reason');
  });

  it("every client call to a reason-required endpoint sends x-audit-reason", () => {
    /*
     * The mismatch that produced this bug, made checkable.
     *
     * Matches client functions that take a `reason` parameter — the signal that
     * a call is audited — and asserts each actually forwards it as the header.
     * A function that accepts a reason and drops it is the precise shape of the
     * original defect: the caller believes it is auditing and nothing arrives.
     */
    const offenders: string[] = [];
    const fnRe = /export (?:async )?function (\w+)\(([^)]*)\)[\s\S]{0,900}?\n\}/g;
    let m: RegExpExecArray | null;
    while ((m = fnRe.exec(CLIENT)) !== null) {
      const [body, name, params] = [m[0], m[1], m[2]];
      if (!/\breason\b/.test(params)) continue;
      if (!body.includes("/api/admin") && !body.includes("adminHeaders")) continue;
      /*
       * adminRequest(path, reason, init) is the shared helper that attaches the
       * header — 38 functions route through it. My first version of this guard
       * only looked for a literal "x-audit-reason" and flagged all 38 as
       * violations, which would have made it the guard people delete. Routing
       * through the chokepoint IS sending the header.
       */
      const sends = body.includes("x-audit-reason") || /adminRequest\s*[<(]/.test(body);
      if (!sends) offenders.push(`${name} takes a reason but never sends x-audit-reason`);
    }
    expect(offenders).toEqual([]);
  });
});
