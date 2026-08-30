import { useCallback, useEffect, useState } from "react";
import * as api from "../lib/api";

/**
 * Set whether a city can accept signups.
 *
 * THE SERVER SIDE HAS BEEN COMPLETE THE WHOLE TIME — POST /api/admin/cms/city,
 * saveCity, and even a correctly-routed adminSaveCity client function. What was
 * missing was any control that calls it, so the only way to change a city's
 * availability was to ask someone with a shell. That is the fifth instance of
 * the same pattern in this build: invite tokens, audit reasons, the capability
 * field, invitation revoke, and now city status — a complete server capability
 * with no client path to reach it.
 *
 * BOTH DIRECTIONS, deliberately. A one-way switch with a scary confirmation is
 * worse than no switch: the moment something is wrong after a flip, the person
 * who needs to undo it is the person who cannot.
 */

const STATUS_COPY: Record<string, { label: string; effect: string; tone: string }> = {
  active: {
    label: "Open",
    effect: "Anyone can create an account.",
    tone: "bg-emerald-100 text-emerald-900",
  },
  invite_only: {
    label: "Invite only",
    effect: "Only people holding a valid invitation can create an account. Existing members sign in normally.",
    tone: "bg-[#FF5741]/15 text-[#14171C]",
  },
  coming_soon: {
    label: "Coming soon",
    effect: "Nobody can create an account. The city shows as not yet open.",
    tone: "bg-amber-100 text-amber-900",
  },
  inactive: {
    label: "Inactive",
    effect: "Nobody can create an account and the city is hidden.",
    tone: "bg-slate-200 text-slate-700",
  },
};

type CityRow = { id: string; name: string; state: string; slug: string; status: string };

export function CityStatusAdminSection() {
  const [cities, setCities] = useState<CityRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** The status awaiting confirmation, keyed by city id. */
  const [pending, setPending] = useState<{ id: string; status: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    void api.adminCmsOverview("City status").then((r) => {
      if (r.ok) setCities(r.data.cities as unknown as CityRow[]);
      else setError(r.error.message);
    });
  }, []);
  useEffect(load, [load]);

  const apply = async () => {
    /*
     * NO SILENT RETURNS. Both guards below used to `return` with no trace: no
     * request, no state change, no message — and because setError(null) never
     * ran, whatever error was already on screen STAYED, which reads as "the
     * click did nothing and the old error is still true".
     *
     * That is the same class as the FAB's "Propose a run" and the pending RSVP
     * button: a control that looks live and does nothing. The shared shape is a
     * handler whose failure produces no network event, so it is invisible in
     * the one place anyone would look.
     *
     * Neither branch should be reachable. If either fires, saying so is worth
     * more than failing quietly.
     */
    setError(null);
    if (!pending) {
      setError("Nothing selected to change. Pick a status and try again.");
      return;
    }
    const city = cities?.find((c) => c.id === pending.id);
    if (!city) {
      setError(`Couldn't find ${pending.id} in the loaded city list. Reload the page and try again.`);
      return;
    }
    // saveCity is a full upsert: missing any of these returns invalid_city.
    const missing = (["name", "state", "slug"] as const).filter((k) => typeof city[k] !== "string" || !city[k]);
    if (missing.length > 0) {
      setError(`${city.id} is missing ${missing.join(", ")} — saving would be rejected. This is a data problem, not a permissions one.`);
      return;
    }
    setBusy(true);
    /*
     * saveCity requires name, state and slug — it is a full upsert, not a
     * patch. Sending status alone returns invalid_city, so the existing row is
     * spread underneath the change.
     */
    const r = await api.adminSaveCity(
      { id: city.id, name: city.name, state: city.state, slug: city.slug, status: pending.status },
      /*
       * ASCII arrow. The normaliser in adminRequest would now escape a U+2192
       * safely, but writing one here would put "&#8594;" in the audit log —
       * correct, and worse to read than "->". Fix the transport for the class;
       * do not rely on it for text we control.
       */
      `City status -> ${pending.status}`,
    );
    setBusy(false);
    if (!r.ok) { setError(r.error.message); return; }
    setPending(null);
    load();
  };

  return (
    <section className="mt-8" aria-labelledby="city-status-heading">
      <p className="text-[11px] font-bold uppercase tracking-widest text-[#FF5741]">Availability</p>
      <h2 id="city-status-heading" className="mt-1 text-lg font-extrabold text-slate-900">City status</h2>
      <p className="mt-1 text-[13px] text-slate-500">Controls whether people can create an account.</p>

      {error ? <p className="mt-2 text-[13px] font-semibold text-rose-600">{error}</p> : null}

      {cities === null ? (
        <p className="mt-4 text-[13px] text-slate-400">Loading…</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {cities.map((city) => {
            const current = STATUS_COPY[city.status] ?? { label: city.status, effect: "", tone: "bg-slate-100 text-slate-700" };
            const confirming = pending?.id === city.id;
            const next = confirming ? STATUS_COPY[pending.status] : null;
            return (
              <li key={city.id} className="rounded-2xl bg-white p-4 ring-1 ring-slate-200/70">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[15px] font-bold text-slate-900">{city.name}, {city.state}</span>
                  {/* Current status, prominent — otherwise the only way to know
                      whether signup is open is to open a private window and try. */}
                  <span className={`shrink-0 rounded-full px-3 py-1 text-[12px] font-bold ${current.tone}`}>{current.label}</span>
                </div>
                <p className="mt-1 text-[12px] text-slate-500">{current.effect}</p>

                {confirming && next ? (
                  <div className="mt-3 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
                    {/* Confirmation, because this decides whether anyone can
                        join — and it states the CONSEQUENCE rather than asking
                        "are you sure", which nobody reads. */}
                    <p className="text-[13px] font-bold text-slate-900">Change to {next.label}?</p>
                    <p className="mt-0.5 text-[12px] text-slate-600">{next.effect}</p>
                    <div className="mt-3 flex gap-2">
                      <button
                        type="button"
                        onClick={() => setPending(null)}
                        className="h-11 flex-1 rounded-xl bg-white text-[13px] font-bold text-slate-700 ring-1 ring-slate-300"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => void apply()}
                        disabled={busy}
                        className="h-11 flex-1 rounded-xl bg-[#14171C] text-[13px] font-bold text-white disabled:opacity-40"
                      >
                        {busy ? "Saving…" : `Set ${next.label}`}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {/*
                      Every state is one click away IN BOTH DIRECTIONS. Going
                      back to Open must be exactly as easy as leaving it — if
                      something is wrong after a flip, the person who needs to
                      undo it is the person who cannot wait.
                    */}
                    {Object.entries(STATUS_COPY).map(([value, meta]) => (
                      <button
                        key={value}
                        type="button"
                        disabled={value === city.status}
                        onClick={() => setPending({ id: city.id, status: value })}
                        className="h-11 rounded-xl px-3 text-[13px] font-bold text-slate-700 ring-1 ring-slate-300 disabled:bg-slate-100 disabled:text-slate-400 disabled:ring-0"
                      >
                        {value === city.status ? `${meta.label} (current)` : meta.label}
                      </button>
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
