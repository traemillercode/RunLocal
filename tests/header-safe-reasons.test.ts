/**
 * No audit reason can contain a character that makes fetch() throw.
 *
 * HTTP header values are ISO-8859-1. ONE code point above 0xFF makes fetch()
 * throw synchronously, before a socket opens — so there is no request, nothing
 * in the Network tab, and because the throw is a TypeError, request()'s catch
 * takes the branch that blames the connection.
 *
 * A `→` in "City status → invite_only" did exactly that. Confirmed live: same
 * endpoint, same method, only the reason differing — with the arrow, TypeError;
 * with "->", 200.
 *
 * THE SUITE COULD NOT SEE IT. Every existing test exercises saveCity
 * server-side, so the header is never constructed. The failure lived entirely
 * in the gap between the client call and the network.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { auditReasonHeader } from "../src/lib/api";
import { readCode } from "./helpers/source";

describe("the normaliser makes any reason header-safe", () => {
  it("escapes the character that caused this", () => {
    expect(auditReasonHeader("City status → invite_only")).toBe("City status &#8594; invite_only");
  });

  it("escapes the free-text hazards an admin will actually type", () => {
    // Every reason box on the admin page is free text. A smart quote pasted
    // from a doc, or an em dash, fails identically with an identical message.
    for (const ch of ["\u2019", "\u201C", "\u2014", "\u2026", "\u00A0".repeat(0) + "\u{1F600}"]) {
      const out = auditReasonHeader(`why ${ch} because`);
      expect([...out].every((c) => c.codePointAt(0)! <= 0xff), `${ch} survived`).toBe(true);
    }
  });

  it("leaves ordinary text untouched", () => {
    // Latin-1 is legal in a header, so accented names must not be mangled.
    expect(auditReasonHeader("Rejected: spam")).toBe("Rejected: spam");
    expect(auditReasonHeader("Café closed")).toBe("Café closed");
  });

  it("records what was typed rather than dropping it", () => {
    /*
     * Numeric references, not stripping. The audit log's job is to say what the
     * operator wrote; a reason silently missing its punctuation is a worse
     * record than one carrying an escape.
     */
    expect(auditReasonHeader("→")).toContain("8594");
  });
});

describe("every header site goes through the normaliser", () => {
  it("no raw reason is assigned to x-audit-reason", () => {
    // Eleven sites attach this header; ten did it inline, bypassing
    // adminRequest. Normalising only the chokepoint would have left those.
    const CLIENT = readCode(new URL("../src/lib/api.ts", import.meta.url));
    const raw = [...CLIENT.matchAll(/"x-audit-reason":\s+(?!auditReasonHeader\()[A-Za-z_$]/g)];
    expect(raw.map((m) => CLIENT.slice(m.index!, m.index! + 60))).toEqual([]);
  });
});

describe("no admin call passes a non-Latin-1 literal", () => {
  it("no source file hands an admin* function a string with a code point > 0xFF", () => {
    /*
     * The class, checked at the source. This was the ONLY such string in the
     * codebase, and it cost a full debugging session across three people
     * because every symptom pointed away from it.
     */
    const roots = ["../src/components", "../src/pages"];
    const offenders: string[] = [];
    for (const root of roots) {
      const dir = new URL(root, import.meta.url).pathname;
      for (const f of readdirSync(dir).filter((x) => x.endsWith(".tsx") || x.endsWith(".ts"))) {
        const src = readCode(new URL(`${root}/${f}`, import.meta.url));
        // Reason arguments are the second positional arg to an admin* call, or
        // a template literal near one. Scan any admin* call's arguments.
        // Window must reach the LAST argument — the reason is usually second and
        // the first can be a large object literal. 300 stopped short of it, so
        // reintroducing the arrow still passed.
        for (const m of src.matchAll(/\bapi\.admin\w+\(([\s\S]{0,1200}?)\);/g)) {
          const bad = [...m[1]].filter((c) => c.codePointAt(0)! > 0xff);
          if (bad.length > 0) offenders.push(`${f}: ${bad.join("")} in ${m[1].slice(0, 60)}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("the temporary override is gone", () => {
  it("cityStatus resolves from the store and seed only", () => {
    /*
     * Deleted in the same commit as the arrow fix, deliberately. It resolved
     * AHEAD of both store and seed, so once the control could POST it would
     * have written the store, returned 200, and the UI would still have shown
     * whatever the env var said — indistinguishable from the control being
     * broken a third time.
     */
    const CMS = readFileSync(new URL("../src/server/cms.ts", import.meta.url).pathname, "utf8");
    expect(CMS).not.toContain("CITY_STATUS_OVERRIDE");
    expect(CMS).not.toContain("statusOverride");
  });
});
