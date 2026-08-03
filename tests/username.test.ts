/**
 * Username normalization rules — the documented contract, enforced.
 *
 * Allowed: 3–24 chars, must start with a letter (a–z), then lowercase
 * letters, digits, underscore (`_`) or hyphen (`-`). Case-insensitive:
 * input is trimmed and lowercased, so any casing of the same name is the
 * same username (the second claim is a duplicate).
 */
import { describe, expect, it } from "vitest";
import { normalizeUsername, USERNAME_MAX, USERNAME_MIN, USERNAME_PATTERN } from "../src/lib/username";

describe("normalizeUsername — accepted names", () => {
  it("accepts a plain lowercase handle", () => {
    expect(normalizeUsername("jordanlee")).toBe("jordanlee");
  });
  it("normalizes case to lowercase (case-insensitive uniqueness)", () => {
    expect(normalizeUsername("JordanLee")).toBe("jordanlee");
    expect(normalizeUsername("JORDANLEE")).toBe("jordanlee");
    expect(normalizeUsername("JoRdAnLeE")).toBe("jordanlee");
  });
  it("trims surrounding whitespace and normalizes the rest", () => {
    expect(normalizeUsername("  jordanlee  ")).toBe("jordanlee");
    expect(normalizeUsername("\tjordan_lee\n")).toBe("jordan_lee");
  });
  it("allows digits, underscore and hyphen after the leading letter", () => {
    expect(normalizeUsername("j0rdan")).toBe("j0rdan");
    expect(normalizeUsername("jordan_lee")).toBe("jordan_lee");
    expect(normalizeUsername("jordan-lee")).toBe("jordan-lee");
    expect(normalizeUsername("j0rdan_lee-2026")).toBe("j0rdan_lee-2026");
  });
  it(`accepts the boundary lengths (${USERNAME_MIN} and ${USERNAME_MAX} chars)`, () => {
    expect(normalizeUsername("abc")).toBe("abc");
    expect(normalizeUsername("a".repeat(USERNAME_MIN))).toBe("a".repeat(USERNAME_MIN));
    const max = `a${"b".repeat(USERNAME_MAX - 1)}`;
    expect(max.length).toBe(USERNAME_MAX);
    expect(normalizeUsername(max)).toBe(max);
  });
});

describe("normalizeUsername — rejected names", () => {
  it("rejects empty and whitespace-only input", () => {
    expect(normalizeUsername("")).toBeNull();
    expect(normalizeUsername("   ")).toBeNull();
  });
  it("rejects names that are too short or too long", () => {
    expect(normalizeUsername("ab")).toBeNull();
    expect(normalizeUsername("a".repeat(USERNAME_MIN - 1))).toBeNull();
    expect(normalizeUsername(`a${"b".repeat(USERNAME_MAX)}`)).toBeNull(); // 25 chars
  });
  it("rejects a leading digit, underscore, or hyphen", () => {
    expect(normalizeUsername("1jordan")).toBeNull();
    expect(normalizeUsername("_jordan")).toBeNull();
    expect(normalizeUsername("-jordan")).toBeNull();
    // but the same characters are fine later in the name
    expect(normalizeUsername("j_1-a")).toBe("j_1-a");
  });
  it("rejects disallowed characters (spaces, symbols, non-ASCII)", () => {
    expect(normalizeUsername("jordan lee")).toBeNull();
    expect(normalizeUsername("jordan@lee")).toBeNull();
    expect(normalizeUsername("jordan.lee")).toBeNull();
    expect(normalizeUsername("jordan!")).toBeNull();
    expect(normalizeUsername("jördan")).toBeNull();
    expect(normalizeUsername("跑者")).toBeNull();
  });
  it("rejects a bare number or an all-digit name", () => {
    expect(normalizeUsername("123456")).toBeNull();
  });
});

describe("USERNAME_PATTERN contract", () => {
  it("matches only the documented character set, anchored end-to-end", () => {
    expect(USERNAME_PATTERN.source).toBe("^[a-z][a-z0-9_-]{2,23}$");
    expect(USERNAME_PATTERN.test("abc")).toBe(true);
    expect(USERNAME_PATTERN.test("ABC")).toBe(false); // uppercase handled by normalization, not the pattern
    expect(USERNAME_PATTERN.test("a b")).toBe(false);
  });
});
