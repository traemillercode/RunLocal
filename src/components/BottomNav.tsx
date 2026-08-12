import { Link, useLocation } from "react-router-dom";
import { Icon } from "./ui";
import { activeForPath, entriesForSurface } from "../lib/nav";

/**
 * Mobile bottom tab bar — five tabs derived from the single nav model
 * (src/lib/nav.ts). Active state uses the SAME activeForPath helper as the
 * desktop sidebar, so detail routes (e.g. /events/:id) keep the tab
 * highlighted consistently.
 */
export function BottomNav() {
  const { pathname } = useLocation();
  const tabs = entriesForSurface("bottom");
  return (
    <nav
      aria-label="Primary"
      data-tour-target="bottom-nav"
      className="app-shell-nav fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/85"
    >
      <div
        className="mx-auto grid w-full max-w-md grid-cols-5 px-1"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {tabs.map((t) => {
          const active = activeForPath(t, pathname);
          return (
            <Link
              key={t.id}
              to={t.route}
              aria-current={active ? "page" : undefined}
              className={`flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-lg text-[11px] font-semibold transition-colors ${
                active ? "text-[#14171C]" : "text-slate-400 active:text-slate-600"
              }`}
            >
              <span
                className={`grid h-7 w-12 place-items-center rounded-full ${active ? "bg-[#FF5741] shadow-sm" : ""}`}
              >
                <Icon name={t.icon} className="h-5 w-5" />
              </span>
              {t.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
