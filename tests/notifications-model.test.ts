/**
 * Pure-model tests for the notification category metadata and inbox helpers.
 *
 * Honesty contract: only categories with a real server producer may be
 * marked available; the rest must be labeled as not delivering today. If a
 * new producer category is added to the API, this test forces a conscious
 * update of the availability flags before UI copy can claim delivery.
 */
import { describe, expect, it } from "vitest";
import { NOTIFICATION_CATEGORY_META, categoryMeta, notificationTime, unreadCountOf } from "../src/lib/notifications";

describe("notification category metadata", () => {
  it("covers every persisted preference key exactly once", () => {
    const keys = NOTIFICATION_CATEGORY_META.map((m) => m.key).sort();
    expect(keys).toEqual(["account_alerts", "community_updates", "run_reminders"]);
  });

  it("marks only Community updates as available today", () => {
    const available = NOTIFICATION_CATEGORY_META.filter((m) => m.available);
    expect(available.map((m) => m.key)).toEqual(["community_updates"]);
  });

  it("labels unavailable categories honestly (no implied delivery)", () => {
    for (const meta of NOTIFICATION_CATEGORY_META) {
      expect(meta.label.length).toBeGreaterThan(0);
      expect(meta.description.length).toBeGreaterThan(0);
    }
    // The two categories with no producer right now are explicitly not available.
    expect(categoryMeta("run_reminders").available).toBe(false);
    expect(categoryMeta("account_alerts").available).toBe(false);
  });

  it("falls back to the first category for an unknown key", () => {
    // @ts-expect-error — deliberate unknown key
    expect(categoryMeta("unknown_key")).toBe(NOTIFICATION_CATEGORY_META[0]);
  });
});

describe("unreadCountOf", () => {
  it("counts only notifications without readAt", () => {
    const items = [
      { id: "a", readAt: null },
      { id: "b", readAt: "2026-08-12T00:00:00.000Z" },
      { id: "c", readAt: null },
    ];
    expect(unreadCountOf(items as never[])).toBe(2);
  });

  it("returns zero for an empty inbox", () => {
    expect(unreadCountOf([])).toBe(0);
  });
});

describe("notificationTime", () => {
  it("formats a valid timestamp into a non-empty local string", () => {
    const out = notificationTime("2026-08-01T12:00:00.000Z");
    expect(out.length).toBeGreaterThan(0);
    expect(out).not.toContain("NaN");
  });

  it("returns an empty string for an invalid timestamp", () => {
    expect(notificationTime("not-a-date")).toBe("");
  });
});
