/**
 * The first five minutes of a new account.
 *
 * From the first real user report — every item here was hit by a tester within
 * minutes of signing up, which is the part that makes them worth more than
 * their size.
 */
import { describe, expect, it } from "vitest";
import { readCode } from "./helpers/source";

const LOGIN = readCode(new URL("../src/pages/LoginPage.tsx", import.meta.url));
const FIELDS = readCode(new URL("../src/components/BirthdateFields.tsx", import.meta.url));

describe("date of birth is typed, not picked", () => {
  it("no native date picker on the signup form", () => {
    /*
     * type="date" opens a picker that starts at the current year, so a birth
     * year means scrolling back three decades — and this is the FIRST field in
     * the flow, so it is the first impression of the product.
     */
    expect(LOGIN).not.toContain('type="date"');
    expect(LOGIN).toContain("<BirthdateFields");
  });

  it("three numeric fields, not one free-text box", () => {
    /*
     * A single box needs a format hint, accepts ambiguous input — 03/04/1990 is
     * two different dates depending on where you live — and has to be parsed.
     */
    expect(FIELDS).toContain('inputMode="numeric"');
    for (const auto of ["bday-month", "bday-day", "bday-year"]) {
      expect(FIELDS).toContain(auto);
    }
  });

  it("still emits YYYY-MM-DD, so nothing downstream changes", () => {
    // The server contract, validateBirthdate and the stored format are all
    // untouched — this is an input-shape change only.
    expect(FIELDS).toContain("`${y}-${m.padStart(2, \"0\")}-${d.padStart(2, \"0\")}`");
  });

  it("emits nothing until the date is complete", () => {
    /*
     * A partial value would fail validation and show an error while someone is
     * still typing, which is what makes a form feel hostile.
     */
    expect(FIELDS).toContain('if (y.length === 4 && m.length >= 1 && d.length >= 1)');
  });

  it("every field is labelled for screen readers", () => {
    // Placeholders are not labels, and MM/DD/YYYY alone says nothing to someone
    // who cannot see the placement.
    expect((FIELDS.match(/<span className="sr-only">/g) ?? []).length).toBe(3);
  });
});

describe("the phone field states a purpose instead of a promise", () => {
  it("does not promise never to send SMS", () => {
    /*
     * The worst version: friction with no payoff, reads as data collection for
     * its own sake, and closes a door we want open — a run leader needs to
     * reach people when plans change.
     */
    expect(LOGIN).not.toContain("No SMS is ever sent");
  });

  it("says what it is for", () => {
    // Real and not marketing: the number you want when someone does not show up
    // to a run that meets at dawn.
    expect(LOGIN).toContain("So a run leader can reach you if plans change");
    expect(LOGIN).toContain("emergency contact");
  });

  it("stays optional", () => {
    // A required phone number on a running app is a reason not to sign up.
    expect(LOGIN).toContain("Phone (optional)");
  });

  it("still says it is never shown publicly", () => {
    // Dropping the over-promise is not the same as dropping the assurance that
    // matters — that it is not on your profile.
    expect(LOGIN).toContain("Never shown publicly");
  });
});
