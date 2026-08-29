import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Icon } from "./ui";
import { activeForPath, entriesForSurface } from "../lib/nav";
import { useUnreadMessagesCount } from "../state/unreadMessages";
import { CreateMenuSheet } from "./CreateMenuSheet";

/**
 * Mobile bottom tab bar — tabs derived from the single nav model
 * (src/lib/nav.ts), column count driven by however many are actually
 * surfaced there rather than a hardcoded 5, so adding/removing a tab (like
 * Messages) never silently breaks the grid. Active state uses the SAME
 * activeForPath helper as the desktop sidebar, so detail routes (e.g.
 * /events/:id) keep the tab highlighted consistently.
 *
 * The "+" create button is a raised FAB overlaying the bar, not a 7th tab -
 * the row is already 6 columns wide, and a create action behaves
 * differently from navigation (it opens a menu, it doesn't go to a page),
 * so it doesn't belong in the same data-driven Link list.
 */
export function BottomNav() {
  const { pathname } = useLocation();
  const tabs = entriesForSurface("bottom");
  const unreadMessages = useUnreadMessagesCount();
  const [createOpen, setCreateOpen] = useState(false);
  return (
    <nav
      aria-label="Primary"
      data-tour-target="bottom-nav"
      className="app-shell-nav fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/85"
    >
      <button
        type="button"
        onClick={() => setCreateOpen(true)}
        aria-label="Create"
        style={{ transform: "translate(-50%, -78%)" }}
        className="absolute left-1/2 top-0 z-10 grid h-14 w-14 place-items-center rounded-full bg-[#FF5741] text-[#14171C] shadow-lg ring-4 ring-white active:scale-95"
      >
        <Icon name="plus" className="h-6 w-6" />
      </button>
      <div
        className="mx-auto grid w-full max-w-md px-1"
        style={{ paddingBottom: "env(safe-area-inset-bottom)", gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}
      >
        {tabs.map((t) => {
          const active = activeForPath(t, pathname);
          const badge = t.id === "messages" ? unreadMessages : 0;
          return (
            <Link
              key={t.id}
              to={t.route}
              aria-current={active ? "page" : undefined}
              aria-label={badge > 0 ? `${t.label} — ${badge} unread` : t.label}
              className={`flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-lg text-[11px] font-semibold transition-colors ${
                active ? "text-[#14171C]" : "text-slate-400 active:text-slate-600"
              }`}
            >
              <span
                className={`relative grid h-7 w-12 place-items-center rounded-full ${active ? "bg-[#FF5741] shadow-sm" : ""}`}
              >
                <Icon name={t.icon} className="h-5 w-5" />
                {badge > 0 ? (
                  <span aria-hidden="true" className="absolute -right-0.5 -top-0.5 grid min-w-[18px] place-items-center rounded-full bg-[#FF5741] px-1 text-[11px] font-extrabold leading-[18px] text-white ring-2 ring-white">
                    {badge > 9 ? "9+" : badge}
                  </span>
                ) : null}
              </span>
              {t.label}
            </Link>
          );
        })}
      </div>
      {createOpen ? <CreateMenuSheet onClose={() => setCreateOpen(false)} /> : null}
    </nav>
  );
}
