import { Link, useNavigate } from "react-router-dom";
import type { City } from "../types";
import { AccountMenuButton } from "./AccountMenu";
import { useAccount } from "../state/account";
import { Chip, Icon } from "./ui";
import { Sheet } from "./ui";

/**
 * Always-visible guest CTA in the header. Guests get a clear "Log in"
 * button next to the account avatar so sign-in is reachable on mobile
 * without hunting through menus — and it never sits behind the bottom nav
 * (it lives in the sticky top header). Hidden once a session exists.
 * Purely a link to /login — no client-side role logic.
 */
function GuestLoginCta() {
  const navigate = useNavigate();
  const { me } = useAccount();
  if (me?.status === "signed_in") return null;
  return (
    <button
      type="button"
      onClick={() => navigate("/login")}
      aria-label="Log in"
<<<<<<< HEAD
      className="flex h-9 shrink-0 items-center rounded-full bg-[#FF5741] px-2 text-[12px] font-extrabold text-[#14171C] active:bg-[#E44735] min-[400px]:px-3 min-[400px]:text-[13px]"
=======
      className="flex h-9 shrink-0 items-center rounded-full bg-[#FF5741] px-2 text-[12px] font-extrabold text-[#14171C] shadow-sm active:bg-[#e94735] min-[400px]:px-3 min-[400px]:text-[13px]"
>>>>>>> origin/main
    >
      Log in
    </button>
  );
}

export function Header({ city, onOpenCitySheet }: { city: City; onOpenCitySheet: () => void }) {
  return (
<<<<<<< HEAD
    <header className="sticky top-0 z-40 border-b border-white/10 bg-[#14171C] text-white shadow-sm">
=======
    <header className="app-shell-header sticky top-0 z-40 border-b border-white/10 bg-[#14171C] text-white shadow-sm">
>>>>>>> origin/main
      <div className="mx-auto flex h-14 w-full max-w-md items-center justify-between gap-2 px-3">
        {/* Clickable logo / title — always returns to the city home feed. The
            wordmark is sized down on narrow screens (and hidden entirely only
            below 360px, where the pin icon alone is the brand) so the full "Run
            Local" mark never truncates to "Run L…" on a 390px phone. */}
        <Link
          to="/"
          aria-label="Run Local — home"
          className="flex min-w-0 items-center gap-2 rounded-lg active:opacity-80 min-[420px]:gap-2.5"
        >
<<<<<<< HEAD
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-[#FF5741] text-[#14171C] min-[420px]:h-8 min-[420px]:w-8">
            <Icon name="pin" className="h-5 w-5" />
          </span>
=======
          <img src="/icons/icon-192.png" alt="" className="h-8 w-8 shrink-0 rounded-lg shadow-sm min-[420px]:h-9 min-[420px]:w-9" />
>>>>>>> origin/main
          <span className="hidden whitespace-nowrap text-[15px] font-extrabold tracking-tight min-[360px]:inline min-[420px]:text-[16px] sm:text-[17px]">
            Run <span className="text-[#FF5741]">Local</span>
          </span>
        </Link>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={onOpenCitySheet}
            aria-label={`Change city — current: ${city.name}, ${city.state}`}
            className="flex h-11 items-center gap-1.5 rounded-full bg-white/10 pl-2.5 pr-1.5 text-[13px] font-semibold ring-1 ring-white/20 active:bg-white/20 min-[400px]:pl-3 min-[400px]:pr-2 min-[400px]:text-sm"
          >
            <span className="max-w-[72px] truncate min-[400px]:max-w-24">
              {city.name}, {city.state}
            </span>
            <Icon name="chevronDown" className="h-3.5 w-3.5 text-[#FF5741] min-[400px]:h-4 min-[400px]:w-4" />
          </button>
          <GuestLoginCta />
          <AccountMenuButton />
        </div>
      </div>
    </header>
  );
}

export function CitySheet({
  open,
  onClose,
  cities,
  currentCityId,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  cities: City[];
  currentCityId: string;
  onSelect: (city: City) => void;
}) {
  const current = cities.find((c) => c.id === currentCityId);
  return (
    <Sheet open={open} onClose={onClose} title="Choose your city" subtitle="Run Local is city-scoped — pick the community you run in.">
      <ul className="space-y-2">
        {cities.map((c) => {
          const active = c.id === currentCityId;
          return (
            <li key={c.id}>
              <button
                type="button"
                disabled={!c.live}
                onClick={() => {
                  if (c.live) onSelect(c);
                }}
                className={`flex w-full items-center gap-3 rounded-2xl border px-4 py-3.5 text-left transition-colors ${
                  active ? "border-[#14171C] bg-[#14171C] text-white" : "border-slate-200 bg-white text-slate-800"
                } ${!c.live ? "opacity-60" : "active:bg-slate-50"}`}
              >
                <span
                  className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${
                    active ? "bg-white/15 text-[#FF5741]" : "bg-slate-100 text-slate-500"
                  }`}
                >
                  <Icon name="pin" className="h-4.5 w-4.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-bold">
                    {c.name}, {c.state}
                  </span>
                  <span className={`block truncate text-xs ${active ? "text-white/70" : "text-slate-500"}`}>{c.tagline}</span>
                </span>
                {active ? (
                  <span className="shrink-0">
                    <Icon name="check" className="h-5 w-5 text-[#FF5741]" />
                  </span>
                ) : !c.live ? (
                  <Chip tone={active ? "volt" : "amber"}>Coming soon</Chip>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
      <p className="mt-4 flex items-start gap-2 rounded-xl bg-slate-50 p-3.5 text-xs leading-relaxed text-slate-500">
        <Icon name="spark" className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
        More cities are on the roadmap — the app is built to add new cities without code changes. Request yours by emailing
        hello@runlocal.app.
      </p>
      {current && !current.live ? null : null}
    </Sheet>
  );
}
