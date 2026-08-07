/**
 * Super-admin content management: browse ALL published content (community
 * submissions and seeded preview rows) per city/kind, retitle it, and
 * hide / restore / archive it. Global Admin only — the server enforces
 * `globalOnly` on every endpoint, so City Admins and runners get 401/403 even
 * if this section were somehow reached. Loading is a routine read (no reason
 * prompt); every mutation requires the audited reason below.
 */
import { useState } from "react";
import * as api from "../lib/api";
import { CITIES } from "../data/cities";

type Kind = api.AdminContentRow["kind"] | null;

const KIND_LABEL: Record<Exclude<Kind, null>, string> = {
  event: "Runs / events",
  race: "Races",
  post: "Forum posts",
  group: "Groups",
};

export function ContentManagementSection() {
  const [cityId, setCityId] = useState<string>(CITIES.find((c) => c.live)?.id ?? "columbia-mo");
  const [kind, setKind] = useState<Kind>(null);
  const [rows, setRows] = useState<api.AdminContentRow[] | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  /** Inline title drafts keyed by content id. */
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const load = async () => {
    setError(null);
    setBusy(true);
    const r = await api.adminListContent(cityId, kind);
    setBusy(false);
    if (r.ok) {
      setRows(r.data.results);
      setDrafts({});
    } else {
      setError(r.error.message ?? "Couldn't load content.");
    }
  };

  const mutate = async (id: string, fn: (reason: string) => Promise<api.ApiResult<unknown>>, success: (updated: api.AdminContentRow) => void) => {
    setError(null);
    if (!reason.trim() || reason.trim().length < 5) {
      setError("Enter a reason (min 5 characters) for this moderation action — it's recorded in the audit log.");
      return;
    }
    setActionBusy(id);
    const r = await fn(reason.trim());
    setActionBusy(null);
    if (r.ok) {
      setReason("");
      success((r as { ok: true; data: { content: api.AdminContentRow } }).data.content);
    } else {
      setError(r.error.message ?? "Action failed.");
    }
  };

  const saveTitle = (row: api.AdminContentRow) => {
    const draft = (drafts[row.id] ?? "").trim();
    if (!draft || draft === row.title) return;
    void mutate(row.id, (reason) => api.adminEditContentTitle(row.id, draft, reason), (updated) =>
      setRows((cur) => (cur ? cur.map((r) => (r.id === updated.id ? updated : r)) : cur)),
    );
  };

  const apply = (row: api.AdminContentRow, action: "hide" | "restore" | "archive") =>
    void mutate(row.id, (reason) => api.adminTransitionContent(row.id, action, reason), (updated) =>
      setRows((cur) => (cur ? cur.map((r) => (r.id === updated.id ? updated : r)) : cur)),
    );

  return (
    <section id="content-management" className="mt-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70" aria-labelledby="content-mgmt-heading">
      <h2 id="content-mgmt-heading" className="text-[15px] font-bold text-slate-900">Content management</h2>
      <p className="mt-1 text-xs leading-relaxed text-slate-600">
        Super-admin read/write control over races, runs/events, groups, and forum posts. Loads are routine (no reason
        prompt); hide / restore / archive / retitle are audited and require the reason below. Archived content is
        permanently removed from the public surface (no restore path) — use Hide for temporary removals. City Admins
        and runners are denied server-side.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select aria-label="City" value={cityId} onChange={(e) => setCityId(e.target.value)} className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm">
          {CITIES.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <select aria-label="Content kind" value={kind ?? ""} onChange={(e) => setKind((e.target.value || null) as Kind)} className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm">
          <option value="">All kinds</option>
          {(["event", "race", "post", "group"] as const).map((k) => (
            <option key={k} value={k}>{KIND_LABEL[k]}</option>
          ))}
        </select>
        <button type="button" disabled={busy} onClick={() => void load()} className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-bold text-white disabled:opacity-60">
          {busy ? "Loading…" : "Load content"}
        </button>
      </div>
      <textarea
        rows={2}
        aria-label="Audit reason for content actions"
        placeholder="Reason for hide / restore / archive / retitle (min 5 characters, audited)"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        className="mt-3 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
      />
      {error && <p role="alert" className="mt-2 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      <div className="mt-3 grid gap-2">
        {rows === null ? (
          <p className="text-sm text-slate-600">Pick a city and kind, then load.</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-slate-600">No content matches this filter.</p>
        ) : (
          rows.map((row) => (
            <article key={row.id} className="rounded-xl border border-slate-200 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-slate-600">{KIND_LABEL[row.kind]}</span>
                <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide ${row.source === "submission" ? "bg-orange-100 text-orange-800" : "bg-slate-100 text-slate-500"}`}>
                  {row.source === "submission" ? "community" : "seed"}
                </span>
                {row.hidden && <span className="rounded-md bg-amber-100 px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-amber-800">Hidden</span>}
                {row.archived && <span className="rounded-md bg-red-100 px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-red-800">Archived</span>}
                {row.featured && <span className="rounded-md bg-emerald-100 px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-emerald-800">Featured</span>}
                {row.pinned && <span className="rounded-md bg-sky-100 px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-sky-800">Pinned</span>}
                {row.eventStatus && row.eventStatus !== "published" && (
                  <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-slate-600">event: {row.eventStatus}</span>
                )}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <input
                  aria-label={`Title for ${row.id}`}
                  value={drafts[row.id] ?? row.title}
                  onChange={(e) => setDrafts((d) => ({ ...d, [row.id]: e.target.value }))}
                  onBlur={() => saveTitle(row)}
                  className="min-w-0 flex-1 rounded-lg border border-slate-200 px-2 py-1 text-sm"
                />
                <span className="text-xs text-slate-500">{row.authorLabel ? `by ${row.authorLabel}` : row.refId}</span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {!row.hidden && !row.archived && (
                  <button type="button" disabled={actionBusy === row.id} onClick={() => apply(row, "hide")} className="rounded-lg bg-amber-600 px-2.5 py-1 text-xs font-bold text-white disabled:opacity-60">Hide</button>
                )}
                {row.hidden && !row.archived && (
                  <button type="button" disabled={actionBusy === row.id} onClick={() => apply(row, "restore")} className="rounded-lg bg-emerald-600 px-2.5 py-1 text-xs font-bold text-white disabled:opacity-60">Restore</button>
                )}
                {!row.archived && (
                  <button type="button" disabled={actionBusy === row.id} onClick={() => apply(row, "archive")} className="rounded-lg bg-red-600 px-2.5 py-1 text-xs font-bold text-white disabled:opacity-60">Archive</button>
                )}
                <span className="text-[11px] text-slate-400">id: {row.id}</span>
              </div>
            </article>
          ))
        )}
      </div>
    </section>
  );
}
