import { useEffect, useState } from "react";
import * as api from "../lib/api";

/**
 * The paid sponsorship placement — one larger "featured" slot plus up to
 * three smaller "standard" slots, shown near the top of Events (the most
 * visited page). Deliberately restrained: a business name, a short tagline,
 * and a logo if they have one — not a banner ad, not flashing, not
 * competing visually with the actual run content below it.
 */
export function SponsorStrip({ cityId }: { cityId: string }) {
  const [sponsors, setSponsors] = useState<api.SponsorView[] | null>(null);

  useEffect(() => {
    let live = true;
    void api.getSponsors(cityId).then((r) => { if (live && r.ok) setSponsors(r.data.sponsors); });
    return () => { live = false; };
  }, [cityId]);

  if (!sponsors || sponsors.length === 0) return null;

  const featured = sponsors.find((s) => s.tier === "featured");
  const standard = sponsors.filter((s) => s.tier === "standard");

  return (
    <div className="mb-5 space-y-2">
      {featured ? (
        <a
          href={featured.linkUrl}
          target="_blank"
          rel="noreferrer sponsored"
          className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3.5 transition-colors hover:border-slate-300"
        >
          {featured.logoUrl ? (
            <img src={featured.logoUrl} alt="" className="h-11 w-11 shrink-0 rounded-xl object-cover" />
          ) : (
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[#14171C] text-sm font-extrabold text-white">
              {featured.businessName.slice(0, 1).toUpperCase()}
            </span>
          )}
          <span className="min-w-0 flex-1">
            <span className="block text-[11px] font-bold uppercase tracking-widest text-[#FF5741]">Sponsored</span>
            <span className="block truncate text-[14px] font-bold text-slate-900">{featured.businessName}</span>
            {featured.tagline ? <span className="block truncate text-[12px] text-slate-500">{featured.tagline}</span> : null}
          </span>
        </a>
      ) : null}
      {standard.length > 0 ? (
        <div className="flex gap-2 overflow-x-auto">
          {standard.map((s) => (
            <a
              key={s.id}
              href={s.linkUrl}
              target="_blank"
              rel="noreferrer sponsored"
              className="flex shrink-0 items-center gap-2 rounded-full border border-slate-200 bg-white py-1.5 pl-1.5 pr-3.5 transition-colors hover:border-slate-300"
            >
              {s.logoUrl ? (
                <img src={s.logoUrl} alt="" className="h-6 w-6 rounded-full object-cover" />
              ) : (
                <span className="grid h-6 w-6 place-items-center rounded-full bg-slate-100 text-[11px] font-bold text-slate-500">
                  {s.businessName.slice(0, 1).toUpperCase()}
                </span>
              )}
              <span className="text-[12px] font-semibold text-slate-700">{s.businessName}</span>
            </a>
          ))}
        </div>
      ) : null}
    </div>
  );
}
