/**
 * Accessible overflow ("⋯") menu for the role-aware moderation UI.
 *
 * Renders a 44×44 trigger with an accessible name that includes the entity
 * title ("Actions for Tuesday Track Night"), and — when open — a
 * `role="menu"` panel of `role="menuitem"` rows built from the server-driven
 * capability list (see `actionMenuItems` in `src/lib/actionModel.ts`).
 *
 * Keyboard behavior follows the WAI-ARIA menu pattern:
 * - opening moves focus to the first item;
 * - ArrowUp/ArrowDown rove with wrap, Home/End jump to first/last;
 * - Escape and Tab close (Escape cancels, Tab leaves the menu) and focus
 *   returns to the trigger;
 * - clicking outside closes, and focus returns to the trigger.
 *
 * `z-50` keeps the panel below the Sheet's `z-[70]` so a confirmation sheet
 * can layer over it. When the capability list is empty the component renders
 * nothing at all — no orphan trigger.
 *
 * `ActionMenuPanel` is the pure presentational body (no hooks, no refs) so UI
 * tests can render the real panel markup with react-dom/server.
 */
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { type ActionKey, type ActionMeta } from "../lib/actionModel";
import { Icon } from "./ui";

/** Presentational menu panel — driven by props so tests can render it without state. */
export function ActionMenuPanel({
  items,
  onSelect,
}: {
  items: ActionMeta[];
  onSelect: (key: ActionKey) => void;
}) {
  return (
    <div
      role="menu"
      aria-label="Available actions"
      className="z-50 w-[min(15rem,calc(100vw-1rem))] overflow-hidden rounded-2xl border border-slate-200 bg-white p-1.5 shadow-2xl"
    >
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          role="menuitem"
          onClick={() => onSelect(item.key)}
          className={`flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-[14px] font-semibold transition-colors hover:bg-slate-100 active:bg-slate-200 ${
            item.danger ? "text-red-600" : "text-slate-800"
          }`}
        >
          <span
            className={`grid h-7 w-7 shrink-0 place-items-center rounded-full ${
              item.danger ? "bg-red-50 text-red-600" : "bg-slate-100 text-slate-600"
            }`}
          >
            <Icon name={item.icon} className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1">{item.label}</span>
        </button>
      ))}
    </div>
  );
}

export function ActionMenu({
  entityTitle,
  items,
  onSelect,
}: {
  /** Human title of the entity the actions apply to (used in the trigger's accessible name). */
  entityTitle: string;
  /** Display-ready items from `actionMenuItems` — empty renders nothing. */
  items: ActionMeta[];
  onSelect: (key: ActionKey) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  // Focus management + global close listeners while the menu is open.
  useEffect(() => {
    if (!open) return;

    const firstItem = panelRef.current?.querySelector('[role="menuitem"]') as HTMLElement | null;
    firstItem?.focus();

    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "Tab") {
        // Close and keep focus on the trigger (Escape cancels, Tab leaves the menu).
        e.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (items.length === 0) return null;

  const closeAndSelect = (key: ActionKey) => {
    setOpen(false);
    triggerRef.current?.focus();
    onSelect(key);
  };

  // WAI-ARIA menu roving focus: ArrowUp/ArrowDown wrap, Home/End jump.
  const onPanelKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!open) return;
    const menu = panelRef.current;
    if (!menu) return;
    const rows = Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"]'));
    if (rows.length === 0) return;
    const current = document.activeElement as HTMLElement | null;
    let idx = current ? rows.indexOf(current) : -1;
    if (e.key === "ArrowDown") idx = idx < 0 || idx >= rows.length - 1 ? 0 : idx + 1;
    else if (e.key === "ArrowUp") idx = idx <= 0 ? rows.length - 1 : idx - 1;
    else if (e.key === "Home") idx = 0;
    else if (e.key === "End") idx = rows.length - 1;
    else return;
    e.preventDefault();
    rows[idx]?.focus();
  };

  return (
    <div ref={rootRef} className="relative inline-block" onKeyDown={onPanelKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        aria-label={`Actions for ${entityTitle}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="grid h-11 w-11 place-items-center rounded-full text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 active:bg-slate-200"
      >
        <Icon name="more" className="h-5 w-5" />
      </button>
      {open ? (
        <div ref={panelRef} className="absolute right-0 top-full z-50 mt-1">
          <ActionMenuPanel items={items} onSelect={closeAndSelect} />
        </div>
      ) : null}
    </div>
  );
}
