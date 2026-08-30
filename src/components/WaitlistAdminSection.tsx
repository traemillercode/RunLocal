import { useCallback, useEffect, useMemo, useState } from "react";
import * as api from "../lib/api";

/**
 * The waitlist, and a way to get it out of the system.
 *
 * Part 1 shipped capture with no read path — listWaitlist() existed in the
 * store and nothing called it over HTTP, so entries landed on the Railway
 * volume and could not be looked at. Running an ad against a bucket nobody can
 * open is worse than having no bucket.
 *
 * The COUNT is the headline because it is the number actually watched while a
 * campaign runs. The CSV is the point of the whole feature: this list is a
 * marketing asset and it should not be trapped in a flat file.
 */
export function WaitlistAdminSection() {
  const [entries, setEntries] = useState<api.WaitlistEntryView[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    void api.listWaitlist().then((r) => {
      if (r.ok) setEntries(r.data.entries);
      else setError(r.error.message);
    });
  }, []);
  useEffect(load, [load]);

  /**
   * Built in the browser rather than served as a download endpoint: the data is
   * already here, and a second route would need its own auth, its own audit
   * decision and its own content-type handling for no gain at this size.
   */
  const csv = useMemo(() => {
    if (!entries) return "";
    const cell = (v: string | null) => {
      const s = v ?? "";
      // Quote anything containing a comma, quote or newline, and double inner
      // quotes — a name like O'Brien is fine but "Smith, Jr." would split the row.
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const head = "email,name,source,signed_up,status";
    const rows = entries.map((e) =>
      [cell(e.email), cell(e.name), cell(e.source), cell(e.createdAt), cell(e.status)].join(","),
    );
    return [head, ...rows].join("\n");
  }, [entries]);

  const download = () => {
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `kimbio-waitlist-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const tone: Record<api.WaitlistEntryView["status"], string> = {
    interested: "bg-slate-100 text-slate-700",
    invited: "bg-[#FF5741]/15 text-[#14171C]",
    joined: "bg-emerald-100 text-emerald-800",
  };

  return (
    <section className="mt-8" aria-labelledby="waitlist-heading">
      <p className="text-[11px] font-bold uppercase tracking-widest text-[#FF5741]">Beta</p>
      <div className="mt-1 flex items-baseline justify-between gap-3">
        <h2 id="waitlist-heading" className="text-lg font-extrabold text-slate-900">Waitlist</h2>
        {entries ? (
          <button
            type="button"
            onClick={download}
            disabled={entries.length === 0}
            className="h-11 shrink-0 rounded-xl bg-[#14171C] px-4 text-[13px] font-bold text-white disabled:opacity-40"
          >
            Export CSV
          </button>
        ) : null}
      </div>

      {/* The number, big, because it is what gets watched during a campaign. */}
      <p className="mt-2 text-4xl font-extrabold tabular-nums tracking-tight text-slate-900">
        {entries === null ? "—" : entries.length}
        <span className="ml-2 align-middle text-[13px] font-bold text-slate-500">
          {entries?.length === 1 ? "person waiting" : "people waiting"}
        </span>
      </p>

      {error ? <p className="mt-2 text-[13px] font-semibold text-rose-600">{error}</p> : null}

      {entries === null ? (
        <p className="mt-4 text-[13px] text-slate-400">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="mt-4 rounded-xl bg-slate-50 px-4 py-3 text-[13px] text-slate-500">
          Nobody yet. The form is on the private-beta page.
        </p>
      ) : (
        <ul className="mt-4 space-y-1.5">
          {entries.map((e) => (
            <li key={e.id} className="flex items-center gap-3 rounded-xl bg-white px-4 py-3 ring-1 ring-slate-200/70">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-semibold text-slate-900">
                  {e.name ? `${e.name} · ` : ""}{e.email}
                </span>
                <span className="block truncate text-[12px] text-slate-500">
                  {new Date(e.createdAt).toLocaleDateString()}
                  {e.source ? ` · ${e.source}` : " · direct"}
                </span>
              </span>
              <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${tone[e.status]}`}>
                {e.status}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
