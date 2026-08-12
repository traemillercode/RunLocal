/**
 * Unit tests for the pure moderation action model (`src/lib/actionModel.ts`).
 *
 * The server sends a capability list per role × entity; the model maps it to
 * display-ready menu items. These tests pin the canonical labels, the
 * danger flags, unknown-key tolerance, dedup, and the empty → nothing rule.
 */
import { describe, expect, it } from "vitest";
import { ACTION_KEYS, ACTION_META, actionMenuItems } from "../src/lib/actionModel";

const labels = (keys: string[]) => actionMenuItems(keys).map((m) => m.label);

describe("actionMenuItems — canonical labels per role × entity", () => {
  it("member viewing their own post: edit + delete own", () => {
    expect(labels(["edit_own", "delete_own"])).toEqual(["Edit", "Delete"]);
  });

  it("city admin moderating public content: hide/restore/archive/delete/report", () => {
    expect(labels(["hide", "restore", "archive", "delete", "report"])).toEqual([
      "Hide",
      "Restore",
      "Archive",
      "Delete",
      "Report",
    ]);
  });

  it("submitter on a pending submission: edit + withdraw", () => {
    expect(labels(["edit_pending", "withdraw"])).toEqual(["Edit", "Withdraw"]);
  });

  it("group lead managing a group: members + leaders", () => {
    expect(labels(["manage_members", "manage_leaders"])).toEqual(["Manage members", "Manage leaders"]);
  });

  it("super admin on an account: suspend", () => {
    expect(labels(["suspend"])).toEqual(["Suspend"]);
  });

  it("server order is preserved", () => {
    expect(labels(["delete", "hide", "report"])).toEqual(["Delete", "Hide", "Report"]);
  });

  it("duplicate capabilities collapse to one row", () => {
    expect(labels(["edit_own", "edit_own", "delete_own"])).toEqual(["Edit", "Delete"]);
  });
});

describe("actionMenuItems — unknown keys and empty lists", () => {
  it("ignores unknown capability keys without dropping known ones", () => {
    const items = actionMenuItems(["edit_own", "mystery_action", "delete_own", "fly_to_moon"]);
    expect(items.map((m) => m.key)).toEqual(["edit_own", "delete_own"]);
    expect(items.map((m) => m.label)).toEqual(["Edit", "Delete"]);
  });

  it("returns nothing for an empty list", () => {
    expect(actionMenuItems([])).toEqual([]);
  });

  it("returns nothing for null/undefined capability lists", () => {
    expect(actionMenuItems(null)).toEqual([]);
    expect(actionMenuItems(undefined)).toEqual([]);
  });
});

describe("ACTION_META — metadata integrity", () => {
  it("covers every ActionKey exactly once", () => {
    expect([...ACTION_KEYS].sort()).toEqual(
      [
        "edit",
        "edit_own",
        "delete_own",
        "hide",
        "restore",
        "archive",
        "delete",
        "report",
        "withdraw",
        "edit_pending",
        "manage_members",
        "manage_leaders",
        "suspend",
        "tag",
        "pin",
        "unpin",
      ].sort(),
    );
  });

  it("marks destructive actions as danger", () => {
    expect(ACTION_META.delete_own.danger).toBe(true);
    expect(ACTION_META.delete.danger).toBe(true);
    expect(ACTION_META.suspend.danger).toBe(true);
  });

  it("keeps reversible/management actions non-dangerous", () => {
    expect(ACTION_META.hide.danger).toBe(false);
    expect(ACTION_META.restore.danger).toBe(false);
    expect(ACTION_META.archive.danger).toBe(false);
    expect(ACTION_META.report.danger).toBe(false);
    expect(ACTION_META.withdraw.danger).toBe(false);
    expect(ACTION_META.manage_members.danger).toBe(false);
    expect(ACTION_META.manage_leaders.danger).toBe(false);
    expect(ACTION_META.edit_own.danger).toBe(false);
  });

  it("gives every action a non-empty label and icon", () => {
    for (const key of ACTION_KEYS) {
      expect(ACTION_META[key].label.length).toBeGreaterThan(0);
      expect(ACTION_META[key].icon.length).toBeGreaterThan(0);
    }
  });

  it("uses the ban icon for suspend and the trash icon for deletes", () => {
    expect(ACTION_META.suspend.icon).toBe("ban");
    expect(ACTION_META.delete.icon).toBe("trash");
    expect(ACTION_META.delete_own.icon).toBe("trash");
  });
});
