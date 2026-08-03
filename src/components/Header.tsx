import type { City } from "../types";
import { AccountMenuButton } from "./AccountMenu";
import { Chip, Icon } from "./ui";
import { Sheet } from "./ui";

export function Header({ city, onOpenCitySheet }: { city: City; onOpenCitySheet: () => void }) {
  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-[#0b2b22] text-white shadow-sm">
      <div className="mx-auto flex h-14 w-full max-w-md items-center justify-between gap-2 px-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#c8f169] text-[#0b2b22]">
            <Icon name="pin" className="h-5 w-5" />
          </span>
          <span className="truncate text-[17px] font-extrabold tracking-tight">
            Run <span className="text-[#c8f169]">Local</span>
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={onOpenCitySheet}
            aria-label={`Change city — current: ${city.name}, ${city.state}`}
            className="flex h-11 items-center gap-1.5 rounded-full bg-white/10 pl-3 pr-2 text-sm font-semibold ring-1 ring-white/20 active:bg-white/20"
          >
            <span className="max-w-24 truncate">
              {city.name}, {city.state}
            </span>
            <Icon name="chevronDown" className="h-4 w-4 text-[#c8f169]" />
          </button>
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
                  active ? "border-[#0b2b22] bg-[#0b2b22] text-white" : "border-slate-200 bg-white text-slate-800"
                } ${!c.live ? "opacity-60" : "active:bg-slate-50"}`}
              >
                <span
                  className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${
                    active ? "bg-white/15 text-[#c8f169]" : "bg-slate-100 text-slate-500"
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
                    <Icon name="check" className="h-5 w-5 text-[#c8f169]" />
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
