/**
 * Notifications that clear.
 *
 * An inbox that only accumulates stops being read, which makes every
 * notification we send worth less — including the ones that matter, like a
 * verification approval.
 */
import { describe, expect, it } from "vitest";
import { createMemoryStore } from "../src/server/store";
import { readCode } from "./helpers/source";

const STATE = readCode(new URL("../src/state/notifications.tsx", import.meta.url));
const PAGE = readCode(new URL("../src/pages/NotificationsPage.tsx", import.meta.url));

function seeded() {
  const db = createMemoryStore();
  const a = db.createAccount({ name: "A", email: "a@x.com", cityId: "columbia-mo" });
  const mk = (id: string, read: boolean) =>
    db.addNotification({
      id, accountId: a.id, category: "account_alerts", title: id, body: "b",
      createdAt: new Date().toISOString(), readAt: read ? new Date().toISOString() : null, link: null,
    } as never);
  mk("read1", true);
  mk("unread", false);
  mk("read2", true);
  return { db, accountId: a.id };
}

describe("clear read keeps unread", () => {
  it("removes only the read ones", () => {
    /*
     * The whole point of "clear read": the unread rows are the only state that
     * cannot be recovered by looking somewhere else, so a bulk action must
     * never touch them.
     */
    const { db, accountId } = seeded();
    expect(db.clearReadNotifications(accountId)).toBe(2);
    expect(db.listNotifications(accountId).map((n) => n.id)).toEqual(["unread"]);
  });

  it("does not touch another account's notifications", () => {
    const { db, accountId } = seeded();
    const other = db.createAccount({ name: "B", email: "b@x.com", cityId: "columbia-mo" });
    db.addNotification({
      id: "theirs", accountId: other.id, category: "account_alerts", title: "t", body: "b",
      createdAt: new Date().toISOString(), readAt: new Date().toISOString(), link: null,
    } as never);
    db.clearReadNotifications(accountId);
    expect(db.listNotifications(other.id).map((n) => n.id)).toEqual(["theirs"]);
  });
});

describe("dismiss is optimistic, and rolls back", () => {
  it("removes the row before the server answers", () => {
    // An inbox that waits for a round trip to remove a row feels broken on a
    // slow connection, which is exactly when someone is clearing a backlog.
    const at = STATE.indexOf("const dismiss = useCallback");
    const fn = STATE.slice(at, at + 700);
    expect(fn.indexOf("setNotifications((prev) => prev.filter")).toBeLessThan(fn.indexOf("await api.dismissNotification"));
  });

  it("puts it back when the server refuses", () => {
    /*
     * Silently losing something the person can still act on is worse than the
     * row reappearing — the same reasoning as the block-then-report ordering,
     * where the protective half completes and the reporting half never blocks.
     */
    const at = STATE.indexOf("const dismiss = useCallback");
    const fn = STATE.slice(at, at + 700);
    expect(fn).toContain("if (!result.ok && removed)");
    expect(fn).toContain("setNotifications((prev) => [removed, ...prev])");
  });

  it("corrects the unread count in both directions", () => {
    // A badge that does not match the list is worse than no badge.
    const at = STATE.indexOf("const dismiss = useCallback");
    const fn = STATE.slice(at, at + 700);
    expect(fn).toContain("Math.max(0, (c ?? 0) - 1)");
    expect(fn).toContain("(c ?? 0) + 1");
  });
});

describe("the controls are reachable", () => {
  it("Clear read appears only when there is something to clear", () => {
    // A permanently visible bulk action on an empty list is furniture.
    expect(PAGE).toContain("notifications.some((n) => n.readAt) ?");
    expect(PAGE).toContain("Clear read");
  });

  it("each row can be dismissed", () => {
    expect(PAGE).toContain("onDismiss(");
  });

  it("read rows collapse under an Earlier divider", () => {
    // Derived from the data, so it stays correct as rows are read or dismissed
    // with nothing recalculated.
    expect(PAGE).toContain("Boolean(n.readAt) && (idx === 0 || !notifications[idx - 1].readAt)");
  });
});
