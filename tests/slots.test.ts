/**
 * Slot resolution (bug 1).
 *
 * The model bug: "primary" meant BOTH "the only session" and "the first of
 * two", so the UI read it as "no time" — a single run could never be an
 * evening run, and adding a 6am second session couldn't make the original PM.
 */
import { describe, expect, it } from "vitest";
import { resolveSlot, slotLabel, bySessionTime, totalUnitFor, toTotal, totalUnitLabel } from "../src/lib/slots";

describe("resolveSlot", () => {
  it("derives the slot from a real time, regardless of what is stored", () => {
    // The core fix: a single stored-as-"primary" session with an evening time
    // is genuinely a PM session, which the old model could not express.
    expect(resolveSlot("18:30", "primary")).toBe("pm");
    expect(resolveSlot("06:00", "primary")).toBe("am");
  });

  it("treats noon as PM, matching how 12pm reads", () => {
    expect(resolveSlot("11:59", "primary")).toBe("am");
    expect(resolveSlot("12:00", "primary")).toBe("pm");
    expect(resolveSlot("00:00", "primary")).toBe("am");
    expect(resolveSlot("23:59", "primary")).toBe("pm");
  });

  it("returns 'primary' when no time is set, rather than inventing 'am'", () => {
    // Calendar Spec 4.2: defaulting to AM asserts a commitment the athlete
    // never made. Not knowing is a real state.
    expect(resolveSlot(null, "primary")).toBe("primary");
    expect(resolveSlot(undefined, "primary")).toBe("primary");
    expect(resolveSlot("", "primary")).toBe("primary");
  });

  it("preserves an explicitly stored am/pm when no time is set", () => {
    // withResolvedPacePolicy precedent: the stored value wins; derivation only
    // fills a genuine absence. Existing records are never rewritten.
    expect(resolveSlot(null, "am")).toBe("am");
    expect(resolveSlot(null, "pm")).toBe("pm");
  });

  it("falls back to the stored slot on a malformed time rather than guessing", () => {
    expect(resolveSlot("garbage", "pm")).toBe("pm");
  });
});

describe("slotLabel", () => {
  it("labels from the time, and stays null when there is no honest label", () => {
    expect(slotLabel("06:00", "primary")).toBe("AM");
    expect(slotLabel("18:00", "primary")).toBe("PM");
    expect(slotLabel(null, "primary")).toBeNull();
  });
});

describe("bySessionTime", () => {
  const s = (scheduledTime: string | null, slot: "primary" | "am" | "pm" = "primary") => ({ scheduledTime, slot });

  it("orders two AM sessions correctly — the case the old comparator could not", () => {
    // Old: (a.slot === "pm" ? 1 : 0) - (b.slot === "pm" ? 1 : 0) returned 0 for
    // two AM sessions, leaving their order undefined.
    const out = [s("09:00", "am"), s("06:00", "am")].sort(bySessionTime);
    expect(out.map((x) => x.scheduledTime)).toEqual(["06:00", "09:00"]);
  });

  it("orders a full day chronologically", () => {
    const out = [s("18:30", "pm"), s("06:00", "am"), s("12:15", "pm")].sort(bySessionTime);
    expect(out.map((x) => x.scheduledTime)).toEqual(["06:00", "12:15", "18:30"]);
  });

  it("sorts untimed sessions last, never above a real time", () => {
    const out = [s(null), s("06:00", "am")].sort(bySessionTime);
    expect(out.map((x) => x.scheduledTime)).toEqual(["06:00", null]);
  });

  it("falls back to am-before-pm when neither session has a time", () => {
    const out = [s(null, "pm"), s(null, "am")].sort(bySessionTime);
    expect(out.map((x) => x.slot)).toEqual(["am", "pm"]);
  });
});

describe("total display units (bug 3)", () => {
  it("never displays a total in meters or yards", () => {
    // The reported defect: an AM track session in meters made the day total
    // render as "11229.53". Meters and yards are INPUT units — that is how
    // tracks are measured — and never totals units.
    expect(totalUnitFor(["meters"])).toBe("miles");
    expect(totalUnitFor(["yards"])).toBe("miles");
    expect(totalUnitFor(["meters", "yards"])).toBe("miles");
  });

  it("respects an explicit real unit when one is present", () => {
    expect(totalUnitFor(["meters", "miles"])).toBe("miles");
    expect(totalUnitFor(["meters", "km"])).toBe("km");
    // Miles wins over km when both appear, rather than flipping by ordering.
    expect(totalUnitFor(["km", "miles"])).toBe("miles");
    expect(totalUnitFor(["miles", "km"])).toBe("miles");
  });

  it("converts the reported real case into something a runner thinks in", () => {
    // 8000m track AM + 4mi road PM. Previously rendered as a five-digit meters
    // figure; should read as 5 and 4 miles.
    const unit = totalUnitFor(["meters", "miles"]);
    expect(toTotal(8000, "meters", unit)).toBe(5);
    expect(toTotal(4, "miles", unit)).toBe(4);
  });

  it("rounds to one decimal, never a long float", () => {
    expect(toTotal(5000, "meters", "miles")).toBe(3.1);
    expect(toTotal(1609.34, "meters", "miles")).toBe(1);
    expect(toTotal(10, "km", "miles")).toBe(6.2);
    expect(String(toTotal(7.77777, "miles", "miles"))).not.toMatch(/\d\.\d\d/);
  });

  it("labels totals with a real suffix", () => {
    expect(totalUnitLabel("miles")).toBe("mi");
    expect(totalUnitLabel("km")).toBe("km");
  });
});
