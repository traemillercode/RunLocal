/**
 * No user ever sees a server error code.
 *
 * A signed-out visitor on /groups saw a pink box containing the literal string
 * `sign_in_required`. The cause was one line — `super(message ?? code)` in
 * ApiError — so any of the server's 189 codes lacking an explicit message
 * printed its own name at any of the 47 places that render an error.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { errorCopy, looksLikeCode, GENERIC_ERROR, ERROR_COPY } from "../src/lib/errorCopy";
import { ApiError } from "../src/lib/api";
import { readCode } from "./helpers/source";

describe("an unmapped code never reaches the user", () => {
  it("falls back to something human", () => {
    // The map CANNOT be complete — the server grows codes faster than this file
    // will be updated — so the fallback is the load-bearing part, not the map.
    expect(errorCopy("some_future_code")).toBe(GENERIC_ERROR);
    expect(errorCopy("a_totally_unknown_thing")).not.toContain("_");
  });

  it("ignores a server message that is itself a code", () => {
    // Some handlers pass the code through as the message, which would defeat
    // the map entirely if the message were trusted blindly.
    expect(errorCopy("weird_code", "weird_code")).toBe(GENERIC_ERROR);
    expect(errorCopy("weird_code", "That didn't work.")).toBe("That didn't work.");
  });

  it("recognises codes but not sentences", () => {
    expect(looksLikeCode("sign_in_required")).toBe(true);
    expect(looksLikeCode("verified_runner_required")).toBe(true);
    expect(looksLikeCode("Sign in to see this.")).toBe(false);
    expect(looksLikeCode("Too many attempts. Wait a minute.")).toBe(false);
  });
});

describe("ApiError is the chokepoint", () => {
  it("never exposes the raw code as its message", () => {
    // Fixed here rather than at 47 call sites, so a code added tomorrow is
    // covered without touching a page.
    expect(new ApiError(401, "sign_in_required").message).toBe("Sign in to see this.");
    expect(new ApiError(500, "some_unmapped_code").message).toBe(GENERIC_ERROR);
    expect(new ApiError(500, "some_unmapped_code").message).not.toContain("_");
  });

  it("keeps the code available for branching, just not for display", () => {
    // Pages still need the code to decide between an error and a state — the
    // sign_in_required empty state depends on it.
    expect(new ApiError(401, "sign_in_required").code).toBe("sign_in_required");
  });
});

describe("no mapped copy is itself a code", () => {
  it("every entry reads as a sentence", () => {
    const bad = Object.entries(ERROR_COPY).filter(([, v]) => looksLikeCode(v));
    expect(bad).toEqual([]);
  });
});

describe("no page renders a raw code", () => {
  const PAGES = new URL("../src/pages", import.meta.url).pathname;

  it("no page contains a bare snake_case string in JSX text", () => {
    /*
     * The structural version of the rule. Matches a snake_case literal inside
     * JSX text content — {"some_code"} or >some_code< — rather than in a
     * comparison, since `r.error.code === "sign_in_required"` is exactly how a
     * page SHOULD branch and must not be flagged.
     */
    const offenders: string[] = [];
    for (const f of readdirSync(PAGES).filter((x) => x.endsWith(".tsx"))) {
      const src = readCode(new URL(`../src/pages/${f}`, import.meta.url));
      for (const m of src.matchAll(/>\s*([a-z]+(?:_[a-z0-9]+)+)\s*</g)) {
        offenders.push(`${f}: ${m[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("signed-out is a state, not an error", () => {
  it("My Clubs offers a Sign in action rather than a red box", () => {
    // Third time this dead-end pattern has been removed: a surface that
    // explains why it is empty instead of doing something.
    const src = readFileSync(join(new URL("../src/pages", import.meta.url).pathname, "MyGroupsPage.tsx"), "utf8");
    expect(src).toContain('r.error.code === "sign_in_required"');
    expect(src).toContain("Sign in to see your clubs");
    expect(src).toContain('to="/login"');
  });
});
