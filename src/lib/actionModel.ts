/**
 * Moderation/action menu model — pure logic, unit-tested without a DOM.
 *
 * Phase 1 of the role-aware moderation UI. The server decides which actions
 * a given role may take on a given entity and sends back a capability list
 * (e.g. `["edit_own", "delete_own"]` for a member viewing their own post,
 * `["hide", "restore", "delete"]` for a city admin). This module turns that
 * list into concrete, display-ready menu items: canonical labels, icon names
 * (keys into the `PATHS` icon map in `ui.tsx`), and a danger flag for
 * destructive rows. It never inspects roles, emails, or accounts itself —
 * authorization stays server-side; this is purely presentation metadata.
 *
 * Unknown capability strings are ignored so an older client never renders a
 * broken row when the server ships a new action. An empty list renders
 * nothing (callers must render no trigger at all).
 */
export type ActionKey =
  | "edit"
  | "edit_own"
  | "delete_own"
  | "hide"
  | "restore"
  | "archive"
  | "delete"
  | "report"
  | "withdraw"
  | "edit_pending"
  | "manage_members"
  | "manage_leaders"
  | "suspend"
  | "tag"
  | "pin"
  | "unpin";

export interface ActionMeta {
  /** Stable key, matches the server-provided capability string. */
  key: ActionKey;
  /** Canonical menu label. */
  label: string;
  /** Icon name — must exist in ui.tsx PATHS. */
  icon: string;
  /** Destructive actions render red. */
  danger: boolean;
}

export const ACTION_META: Record<ActionKey, ActionMeta> = {
  edit: { key: "edit", label: "Edit", icon: "pencil", danger: false },
  edit_own: { key: "edit_own", label: "Edit", icon: "pencil", danger: false },
  delete_own: { key: "delete_own", label: "Delete", icon: "trash", danger: true },
  hide: { key: "hide", label: "Hide", icon: "eyeOff", danger: false },
  restore: { key: "restore", label: "Restore", icon: "clock", danger: false },
  archive: { key: "archive", label: "Archive", icon: "lock", danger: false },
  delete: { key: "delete", label: "Delete", icon: "trash", danger: true },
  report: { key: "report", label: "Report", icon: "flag", danger: false },
  withdraw: { key: "withdraw", label: "Withdraw", icon: "close", danger: false },
  edit_pending: { key: "edit_pending", label: "Edit", icon: "pencil", danger: false },
  manage_members: { key: "manage_members", label: "Manage members", icon: "users", danger: false },
  manage_leaders: { key: "manage_leaders", label: "Manage leaders", icon: "shield", danger: false },
  suspend: { key: "suspend", label: "Suspend", icon: "ban", danger: true },
  tag: { key: "tag", label: "Tag a runner", icon: "tag", danger: false },
  pin: { key: "pin", label: "Pin", icon: "pin", danger: false },
  unpin: { key: "unpin", label: "Unpin", icon: "clock", danger: false },
};

/** Every capability key must have resolvable metadata. */
export const ACTION_KEYS: readonly ActionKey[] = Object.keys(ACTION_META) as ActionKey[];

/**
 * Map a server-provided capability list to display-ready menu items.
 * - Unknown keys are ignored (forward-compatible with newer servers).
 * - Duplicates collapse to one row.
 * - Order follows the server's list — the server controls menu priority.
 * - An empty/absent list returns an empty array (render no trigger).
 */
export function actionMenuItems(capabilities: readonly string[] | null | undefined): ActionMeta[] {
  if (!capabilities || capabilities.length === 0) return [];
  const seen = new Set<string>();
  const items: ActionMeta[] = [];
  for (const key of capabilities) {
    if (seen.has(key)) continue;
    seen.add(key);
    const meta = ACTION_META[key as ActionKey];
    if (meta) items.push(meta);
  }
  return items;
}
