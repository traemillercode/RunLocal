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
    expect(keys).toEqual(["account_alerts", "community_updates", "messages", "run_reminders"]);
  });

  it("marks every category available, because each now has a real producer", () => {
    // Was "only Community updates". Three producers have shipped since:
    //   run_reminders    store.ts     "Your run is coming up"
    //   messages         api.ts       new-message notification
    //   account_alerts   admin.ts     appeal decisions
    // Verified each by finding its addNotification call site rather than
    // trusting the metadata flag — the flag is the claim, the producer is the
    // evidence.
    const available = NOTIFICATION_CATEGORY_META.filter((m) => m.available);
    expect(available.map((m) => m.key).sort()).toEqual(["account_alerts", "community_updates", "messages", "run_reminders"]);
  });

  it("labels unavailable categories honestly (no implied delivery)", () => {
    for (const meta of NOTIFICATION_CATEGORY_META) {
      expect(meta.label.length).toBeGreaterThan(0);
      expect(meta.description.length).toBeGreaterThan(0);
    }
    // The ORIGINAL INTENT of this test is worth keeping even though the
    // specific expectations inverted: a category must never advertise
    // delivery it cannot perform. Rather than pinning which categories are
    // unavailable — a list that goes stale every time one ships, which is
    // exactly what happened here — assert the invariant itself: anything
    // marked available must have a producer somewhere in src/server.
    const { readFileSync, readdirSync } = require("node:fs") as typeof import("node:fs");
    const { join } = require("node:path") as typeof import("node:path");
    const serverDir = new URL("../src/server", import.meta.url).pathname;
    const serverSrc = readdirSync(serverDir)
      .filter((f) => f.endsWith(".ts"))
      .map((f) => readFileSync(join(serverDir, f), "utf8"))
      .join("\n");
    for (const meta of NOTIFICATION_CATEGORY_META.filter((m) => m.available)) {
      expect(serverSrc).toContain(`category: "${meta.key}"`);
    }
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
