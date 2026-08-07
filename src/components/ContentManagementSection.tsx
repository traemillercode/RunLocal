/**
 * Admin content management: browse published content (community submissions
 * and seeded preview rows) per city/kind, retitle it, hide / restore / delete
 * it, manage run-day discussion comments, and edit the site announcement.
 *
 * Scope: Global Admins (owner + key admin) operate on any city; City Admins
 * are pinned server-side to their assigned city (`cityScope` prop mirrors the
 * enforced scope for the UI). Verified Runners and Group Leaders are denied
 * server-side. Loading is a routine read (no reason prompt); every mutation
 * requires the audited reason below.
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

export function ContentManagementSection({ cityScope }: { cityScope?: string | null }) {
  const [cityId, setCityId] = useState<string>(cityScope ?? CITIES.find((c) => c.live)?.id ?? "columbia-mo");
  const [kind, setKind] = useState<Kind>(null);
  const [rows, setRows] = useState<api.AdminContentRow[] | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  /** Inline title drafts keyed by content id. */
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  // Discussions
  const [discRows, setDiscRows] = useState<api.AdminDiscussionRow[] | null>(null);
  const [discDrafts, setDiscDrafts] = useState<Record<string, string>>({});
  // Announcement (Global Admin surface)
  const [annText, setAnnText] = useState("");
  const [annLink, setAnnLink] = useState("");
  const [annLoaded, setAnnLoaded] = useState(false);

  const effectiveCity = cityScope ?? cityId;

  const load = async () => {
    setError(null);
    setBusy(true);
    const r = await api.adminListContent(effectiveCity, kind);
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

  const apply = (row: api.AdminContentRow, action: "hide" | "restore" | "archive" | "delete") =>
    void mutate(row.id, (reason) => api.adminTransitionContent(row.id, action, reason), (updated) =>
      setRows((cur) => (cur ? cur.map((r) => (r.id === updated.id ? updated : r)) : cur)),
    );

  // ---- discussions --------------------------------------------------------
  const loadDiscussions = async () => {
    setError(null);
    setBusy(true);
    const r = await api.adminListDiscussions(effectiveCity);
    setBusy(false);
    if (r.ok) {
      setDiscRows(r.data.results);
      setDiscDrafts({});
    } else {
      setError(r.error.message ?? "Couldn't load discussions.");
    }
  };

  const discMutate = async (id: string, fn: (reason: string) => Promise<api.ApiResult<unknown>>, onOk: () => void) => {
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
      onOk();
    } else {
      setError(r.error.message ?? "Action failed.");
    }
  };

  const saveDiscussionBody = (row: api.AdminDiscussionRow) => {
    const draft = (discDrafts[row.id] ?? "").trim();
    if (!draft || draft === row.body) return;
    void discMutate(row.id, (reason) => api.adminEditDiscussion(row.id, { body: draft }, reason), () => void loadDiscussions());
  };

  const removeDiscussion = (row: api.AdminDiscussionRow) =>
    void discMutate(row.id, (reason) => api.adminDeleteDiscussion(row.id, reason), () => void loadDiscussions());

  // ---- announcement -------------------------------------------------------
  const loadAnnouncement = async () => {
    if (cityScope) return; // site-wide announcement: Global Admin only
    const r = await api.adminCmsOverview("Routine announcement read");
    if (r.ok) {
      setAnnText(r.data.settings.announcement?.text ?? "");
      setAnnLink(r.data.settings.announcement?.link ?? "");
      setAnnLoaded(true);
    }
  };

  const saveAnnouncement = async () => {
    setError(null);
    if (!reason.trim() || reason.trim().length < 5) {
      setError("Enter a reason (min 5 characters) for this moderation action — it's recorded in the audit log.");
      return;
    }
    setActionBusy("announcement");
    const text = annText.trim();
    const r = await api.adminSetAnnouncement({ text, ...(annLink.trim() ? { link: annLink.trim() } : {}) }, reason.trim());
    setActionBusy(null);
    if (r.ok) {
      setReason("");
      setError(null);
    } else {
      setError(r.error.message ?? "Couldn't save the announcement.");
    }
  };

  const clearAnnouncement = async () => {
    setError(null);
    if (!reason.trim() || reason.trim().length < 5) {
      setError("Enter a reason (min 5 characters) for this moderation action — it's recorded in the audit log.");
      return;
    }
    setActionBusy("announcement");
    const r = await api.adminClearAnnouncement(reason.trim());
    setActionBusy(null);
    if (r.ok) {
      setReason("");
      setAnnText("");
      setAnnLink("");
    } else {
      setError(r.error.message ?? "Couldn't clear the announcement.");
    }
  };

  return (
    <section id="content-management" className="mt-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70" aria-labelledby="content-mgmt-heading">
      <h2 id="content-mgmt-heading" className="text-[15px] font-bold text-slate-900">Content management</h2>
      <p className="mt-1 text-xs leading-relaxed text-slate-600">
        Admin read/write control over races, runs/events, groups, forum posts, run-day discussions, and the site
        announcement. Loads are routine (no reason prompt); hide / restore / delete / retitle are audited and require
        the reason below. Delete is a soft-delete: the row and its audit trail are preserved, dependent content
        (RSVPs, discussions, ratings, memberships) is archived with it, and there is no restore path — use Hide for
        temporary removals. {cityScope ? `Your enforced city scope: ${cityScope}.` : "Global Admin scope: all cities."}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select
          aria-label="City"
          value={effectiveCity}
          disabled={Boolean(cityScope)}
          onChange={(e) => setCityId(e.target.value)}
          className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm disabled:opacity-60"
        >
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
        placeholder="Reason for hide / restore / delete / retitle / discussion / announcement actions (min 5 characters, audited)"
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
                {row.archived && <span className="rounded-md bg-red-100 px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-red-800">Deleted</span>}
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
                  <button type="button" disabled={actionBusy === row.id} onClick={() => apply(row, "delete")} className="rounded-lg bg-red-600 px-2.5 py-1 text-xs font-bold text-white disabled:opacity-60">Delete (soft)</button>
                )}
                <span className="text-[11px] text-slate-400">id: {row.id}</span>
              </div>
            </article>
          ))
        )}
      </div>

      {/* Run-day discussions (comments) */}
      <div className="mt-5 border-t border-slate-100 pt-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-bold text-slate-900">Run-day discussions (comments)</h3>
          <button type="button" disabled={busy} onClick={() => void loadDiscussions()} className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-60">
            {busy ? "Loading…" : "Load discussions"}
          </button>
        </div>
        <p className="mt-1 text-xs text-slate-600">Threads and comments on event occurrences. Edit blanks out problematic text; Delete soft-removes the record (row preserved for audit).</p>
        <div className="mt-2 grid gap-2">
          {discRows === null ? (
            <p className="text-sm text-slate-600">Load to review discussion comments.</p>
          ) : discRows.length === 0 ? (
            <p className="text-sm text-slate-600">No active discussions in this city.</p>
          ) : (
            discRows.map((d) => (
              <article key={d.id} className="rounded-xl border border-slate-200 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-slate-600">{d.kind === "thread" ? "Thread" : "Comment"}</span>
                  <span className="text-xs text-slate-500">{d.authorLabel ?? "Unknown"} {d.authorEmail ? `· ${d.authorEmail}` : ""} · event {d.eventId}</span>
                </div>
                <input
                  aria-label={`Body for discussion ${d.id}`}
                  value={discDrafts[d.id] ?? d.body}
                  onChange={(e) => setDiscDrafts((x) => ({ ...x, [d.id]: e.target.value }))}
                  onBlur={() => saveDiscussionBody(d)}
                  className="mt-2 w-full rounded-lg border border-slate-200 px-2 py-1 text-sm"
                />
                <div className="mt-2 flex gap-2">
                  <button type="button" disabled={actionBusy === d.id} onClick={() => removeDiscussion(d)} className="rounded-lg bg-red-600 px-2.5 py-1 text-xs font-bold text-white disabled:opacity-60">Delete</button>
                  <span className="text-[11px] text-slate-400">id: {d.id}</span>
                </div>
              </article>
            ))
          )}
        </div>
      </div>

      {/* Site announcement — Global Admin only (site-wide, not city-scoped) */}
      {!cityScope && (
        <div className="mt-5 border-t border-slate-100 pt-4">
          <h3 className="text-sm font-bold text-slate-900">Site announcement</h3>
          <p className="mt-1 text-xs text-slate-600">Site-wide banner (Global Admin only — the announcement is not city-scoped in the data model). Audited with the reason above.</p>
          <div className="mt-2 grid gap-2">
            <input aria-label="Announcement text" placeholder="Announcement text (1-300 chars)" value={annText} onChange={(e) => setAnnText(e.target.value)} className="w-full rounded-lg border border-slate-200 px-2 py-1 text-sm" />
            <input aria-label="Announcement link" placeholder="Optional link (https://…)" value={annLink} onChange={(e) => setAnnLink(e.target.value)} className="w-full rounded-lg border border-slate-200 px-2 py-1 text-sm" />
            <div className="flex gap-2">
              <button type="button" disabled={actionBusy === "announcement"} onClick={() => void (annLoaded ? saveAnnouncement() : loadAnnouncement().then(() => saveAnnouncement()))} className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-60">Save announcement</button>
              <button type="button" disabled={actionBusy === "announcement"} onClick={() => void clearAnnouncement()} className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-60">Clear announcement</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
