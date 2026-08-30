import { useCallback, useEffect, useState } from "react";
import * as api from "../lib/api";

/**
 * The safety queue.
 *
 * Reports could be FILED and not READ — GET /api/admin/safety-reports existed
 * with no client caller. The architecture doc is right that this is worse than
 * having no reporting at all: the form implies someone is looking, and at ten
 * people who know each other it still includes someone reporting a person who
 * made them uncomfortable.
 *
 * Placed FIRST on the admin page, above the pending queue and the city control.
 * Everything else on that page can wait a day.
 */

const STATE: Record<api.SafetyReportView["status"], { label: string; tone: string }> = {
  open: { label: "Open", tone: "bg-[#FF5741] text-[#14171C]" },
  under_review: { label: "Reviewing", tone: "bg-amber-100 text-amber-900" },
  resolved: { label: "Resolved", tone: "bg-emerald-100 text-emerald-900" },
  dismissed: { label: "Dismissed", tone: "bg-slate-200 text-slate-700" },
};

/** What each state may become. Mirrors the server's transition table. */
const NEXT: Record<api.SafetyReportView["status"], api.SafetyReportView["status"][]> = {
  open: ["under_review", "dismissed"],
  under_review: ["resolved", "dismissed"],
  resolved: [],
  dismissed: [],
};

export function SafetyReportsAdminSection() {
  const [reports, setReports] = useState<api.SafetyReportView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState<{ id: string; status: api.SafetyReportView["status"] } | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    void api.listSafetyReports().then((r) => {
      if (r.ok) setReports(r.data.reports);
      else setError(r.error.message);
    });
  }, []);
  useEffect(load, [load]);

  const decide = async () => {
    if (!acting || reason.trim().length < 5) return;
    setBusy(true);
    setError(null);
    const r = await api.decideSafetyReport(acting.id, acting.status, reason.trim());
    setBusy(false);
    if (!r.ok) { setError(r.error.message); return; }
    setActing(null);
    setReason("");
    load();
  };

  // Unresolved first, newest within that — the queue exists to surface what
  // still needs a person, not to be a complete history.
  const sorted = [...(reports ?? [])].sort((a, b) => {
    const aOpen = a.status === "open" || a.status === "under_review";
    const bOpen = b.status === "open" || b.status === "under_review";
    if (aOpen !== bOpen) return aOpen ? -1 : 1;
    return b.createdAt.localeCompare(a.createdAt);
  });
  const openCount = sorted.filter((r) => r.status === "open" || r.status === "under_review").length;

  return (
    <section id="safety" className="mt-4 scroll-mt-4" aria-labelledby="safety-heading">
      <p className="text-[11px] font-bold uppercase tracking-widest text-[#FF5741]">Safety</p>
      <h2 id="safety-heading" className="mt-1 text-lg font-extrabold text-slate-900">
        Reports{openCount > 0 ? <span className="ml-2 rounded-full bg-[#FF5741] px-2 py-0.5 align-middle text-[12px] font-extrabold tabular-nums text-[#14171C]">{openCount}</span> : null}
      </h2>
      {/* A stated response time is what makes the form worth filling in, so it
          should be visible to the person who has to keep it. */}
      <p className="mt-1 text-[13px] text-slate-500">We read every report within 24 hours.</p>

      {error ? <p className="mt-2 text-[13px] font-semibold text-rose-600">{error}</p> : null}

      {reports === null ? (
        <p className="mt-4 text-[13px] text-slate-400">Loading…</p>
      ) : sorted.length === 0 ? (
        <p className="mt-4 rounded-xl bg-slate-50 px-4 py-3 text-[13px] text-slate-500">No reports.</p>
      ) : (
        <ul className="mt-4 space-y-2">
          {sorted.map((r) => {
            const s = STATE[r.status];
            const options = NEXT[r.status];
            return (
              <li key={r.id} className="rounded-2xl bg-white p-4 ring-1 ring-slate-200/70">
                <div className="flex items-start justify-between gap-3">
                  <span className="text-[12px] font-bold text-slate-500">
                    {new Date(r.createdAt).toLocaleString()} · {r.contextType.replace(/_/g, " ")}
                  </span>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${s.tone}`}>{s.label}</span>
                </div>
                {/*
                  WHO REPORTED WHOM. The projection dropped both, so the queue
                  showed a reason and a timestamp with no indication who it was
                  about — and you cannot act on a report whose subject you do
                  not know.
                  Subject first and emphasised: that is the name the reader
                  needs in order to do anything.
                */}
                <p className="mt-1.5 text-[13px] text-slate-600">
                  About <span className="font-bold text-slate-900">{r.subjectName}</span>
                  <span className="text-slate-400"> · reported by </span>
                  <span className="font-semibold text-slate-700">{r.reporterName}</span>
                </p>
                {/* The report text in full. Truncating the one thing a person
                    wrote while distressed would defeat the queue. */}
                <p className="mt-2 whitespace-pre-wrap text-[14px] leading-relaxed text-slate-900">{r.reason}</p>

                {acting?.id === r.id ? (
                  <div className="mt-3 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
                    <label className="block text-[12px] font-bold text-slate-700" htmlFor={`why-${r.id}`}>
                      Why — {STATE[acting.status].label}
                    </label>
                    {/* Reason required by the server: this is a contested
                        judgement another operator may need to understand. */}
                    <textarea
                      id={`why-${r.id}`}
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      rows={2}
                      className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-[14px] outline-none focus:border-[#14171C]"
                    />
                    <div className="mt-2 flex gap-2">
                      <button type="button" onClick={() => { setActing(null); setReason(""); }} className="h-11 flex-1 rounded-xl bg-white text-[13px] font-bold text-slate-700 ring-1 ring-slate-300">
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => void decide()}
                        disabled={busy || reason.trim().length < 5}
                        className="h-11 flex-1 rounded-xl bg-[#14171C] text-[13px] font-bold text-white disabled:opacity-40"
                      >
                        {busy ? "Saving…" : `Mark ${STATE[acting.status].label}`}
                      </button>
                    </div>
                  </div>
                ) : options.length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {options.map((next) => (
                      <button
                        key={next}
                        type="button"
                        onClick={() => { setActing({ id: r.id, status: next }); setReason(""); }}
                        className="h-11 rounded-xl px-3 text-[13px] font-bold text-slate-700 ring-1 ring-slate-300"
                      >
                        {STATE[next].label}
                      </button>
                    ))}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
