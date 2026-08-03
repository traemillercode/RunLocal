import { describe, expect, it } from "vitest";
import { DEFAULT_MIN_AGE, validateBirthdate } from "../src/lib/birthdate";

const NOW = new Date(2026, 7, 3); // Mon Aug 3, 2026 (local)

describe("validateBirthdate (client-side signup guard)", () => {
  it("defaults to the server's minimum age of 16", () => {
    expect(DEFAULT_MIN_AGE).toBe(16);
  });

  it("rejects a missing date", () => {
    expect(validateBirthdate("", NOW)).toEqual({
      ok: false,
      reason: "missing",
      message: expect.stringContaining("birthdate"),
    });
  });

  it("rejects malformed and impossible dates", () => {
    expect(validateBirthdate("not-a-date", NOW)).toMatchObject({ ok: false, reason: "invalid" });
    expect(validateBirthdate("2026-13-01", NOW)).toMatchObject({ ok: false, reason: "invalid" });
    expect(validateBirthdate("2026-00-10", NOW)).toMatchObject({ ok: false, reason: "invalid" });
    // Dates that Date would silently roll over must be rejected.
    expect(validateBirthdate("2026-02-30", NOW)).toMatchObject({ ok: false, reason: "invalid" });
    expect(validateBirthdate("2025-02-29", NOW)).toMatchObject({ ok: false, reason: "invalid" }); // 2025 not a leap year
    expect(validateBirthdate("1988-02-29", NOW).ok).toBe(true); // real leap day, adult
  });

  it("rejects a future date", () => {
    expect(validateBirthdate("2026-08-04", NOW)).toMatchObject({ ok: false, reason: "invalid" });
  });

  it("accepts a runner exactly 16 today", () => {
    const check = validateBirthdate("2010-08-03", NOW);
    expect(check.ok).toBe(true);
    if (check.ok) expect(check.age).toBe(16);
  });

  it("accepts older runners and computes their age", () => {
    const check = validateBirthdate("1988-01-01", NOW);
    expect(check.ok).toBe(true);
    if (check.ok) expect(check.age).toBe(38);
  });

  it("rejects a 15-year-old with the too_young reason", () => {
    const check = validateBirthdate("2010-08-04", NOW);
    expect(check).toMatchObject({ ok: false, reason: "too_young" });
    if (!check.ok) expect(check.message).toContain("16");
  });

  it("supports a custom minimum age (mirrors server override)", () => {
    expect(validateBirthdate("2010-08-04", NOW, 13).ok).toBe(true);
    expect(validateBirthdate("2013-08-04", NOW, 13)).toMatchObject({ ok: false, reason: "too_young" });
  });

  it("treats leap-day birthdays correctly at the boundary", () => {
    // Born Feb 29, 2008 — on Feb 28, 2026 they have (at least) just turned 18.
    expect(validateBirthdate("2008-02-29", new Date(2026, 1, 28)).ok).toBe(true);
    expect(validateBirthdate("2008-02-29", new Date(2026, 2, 1)).ok).toBe(true);
  });
});
