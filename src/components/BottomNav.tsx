import { NavLink } from "react-router-dom";
import { Icon } from "./ui";

const TABS = [
  { to: "/", label: "Events", icon: "home" },
  { to: "/races", label: "Races", icon: "trophy" },
  { to: "/forum", label: "Forum", icon: "chat" },
  { to: "/profile", label: "Profile", icon: "users" },
  { to: "/my-runs", label: "My Runs", icon: "rsvp" },
] as const;

export function BottomNav() {
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/85"
    >
      <div
        className="mx-auto grid w-full max-w-md grid-cols-5 px-1"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {TABS.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.to === "/"}
            className={({ isActive }) =>
              `flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-lg text-[11px] font-semibold transition-colors ${
                isActive ? "text-[#14171C]" : "text-slate-400 active:text-slate-600"
              }`
            }
          >
            {({ isActive }) => (
              <>
                <span
                  className={`grid h-7 w-12 place-items-center rounded-full ${isActive ? "bg-[#FF5741]" : ""}`}
                >
                  <Icon name={t.icon} className="h-5 w-5" />
                </span>
                {t.label}
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
