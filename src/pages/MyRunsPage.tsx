import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import * as api from "../lib/api";
import { Icon } from "../components/ui";
import { SoloRunSheet, LogRunSheet } from "../components/SubmissionSheets";
import { useAccount } from "../state/account";
import { useToast } from "../lib/toast";
import { formatRunDate, groupRunsByMonth, monthKey, monthLabel, orderMyRuns, runStartMs } from "../lib/myRuns";
import { WEEKDAY_LABELS, calendarGridDays, dayAriaLabel, defaultCalendarDay, defaultCalendarMonth, firstInMonthDay, navigateDay } from "../lib/calendar";
import type { NavKey } from "../lib/calendar";

type View = "list" | "calendar";

export function MyRunsPage() {
  const { me } = useAccount();
  const toast = useToast();
  const [runs, setRuns] = useState<api.MyRunView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [view, setView] = useState<View>("list");
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [keepingId, setKeepingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [soloOpen, setSoloOpen] = useState(false);
  const [logRunOpen, setLogRunOpen] = useState(false);
  // The runner's own home city (same source useSelectedCity resolves for
  // signed-in accounts) — never a hardcoded city. Guests/legacy accounts pass
  // "" and the server verdict surfaces in the sheet.
  const cityId = me?.status === "signed_in" ? me.account.cityId ?? "" : "";
  const load = () => { setLoading(true); setError(null); setErrorCode(null); void api.getMyRuns().then((r) => { if (r.ok) setRuns(r.data.runs); else { setError(r.error.message); setErrorCode(r.error.code); } setLoading(false); }); };
  useEffect(() => { if (me?.status === "signed_in") load(); else setLoading(false); }, [me?.status]);
  const sections = useMemo(() => orderMyRuns(runs), [runs]);
  if (me?.status !== "signed_in") return <Page><h1 className="text-2xl font-extrabold tracking-tight text-slate-900">My Runs</h1><p className="mt-2 text-slate-600">Sign in to see your private RSVP list.</p><Link className="mt-5 inline-flex min-h-11 items-center rounded-[10px] bg-[#14171C] px-4 py-2 font-semibold text-white" to="/login">Sign in</Link></Page>;
  if (me.account.status !== "verified") return <Page><h1 className="text-2xl font-extrabold tracking-tight text-slate-900">My Runs</h1><p className="mt-2 text-slate-600">Email verification is required to view your private RSVPs.</p><Link className="mt-5 inline-flex min-h-11 items-center rounded-[10px] bg-[#14171C] px-4 py-2 font-semibold text-white" to="/verify">Verify your account</Link></Page>;
  // Full-page loading covers only the FIRST fetch. Refetches after remove/keep
  // keep the current content mounted (stale rows persist until the response
  // lands — no grid spinner by design) so CalendarGrid's internal post-removal
  // focus restoration survives instead of being wiped by a remount.
  if (loading && runs.length === 0) return <Page><h1 className="text-2xl font-extrabold tracking-tight text-slate-900">My Runs</h1><p className="mt-8 text-center text-slate-500">Loading your RSVPs…</p></Page>;
  if (errorCode === "verified_runner_required") return <Page><h1 className="text-2xl font-extrabold tracking-tight text-slate-900">My Runs</h1><p className="mt-3 text-slate-600">Verification is required to view your private RSVPs.</p><Link className="mt-5 inline-flex min-h-11 items-center rounded-[10px] bg-[#14171C] px-4 py-2 font-semibold text-white" to="/verify">Verify your account</Link></Page>;
  if (error) return <Page><h1 className="text-2xl font-extrabold tracking-tight text-slate-900">My Runs</h1><p className="mt-3 text-slate-600">We couldn’t load your runs.</p><button onClick={load} className="mt-5 inline-flex min-h-11 items-center rounded-[10px] bg-[#14171C] px-4 py-2 font-semibold text-white">Try again</button></Page>;
  const hasRuns = sections.upcoming.length + sections.past.length > 0;
  return <Page><MyRunsHeader view={view} onViewChange={setView} onAddSolo={() => setSoloOpen(true)} onLogRun={() => setLogRunOpen(true)} />{actionError ? <div role="alert" className="mt-4 rounded-xl bg-rose-50 p-3 text-sm font-medium text-rose-800 ring-1 ring-rose-200">{actionError}</div> : null}{!hasRuns ? <Empty /> : view === "calendar" ? <CalendarGrid upcoming={sections.upcoming} onRemove={remove} removingId={removingId} onToggleKeep={toggleKeep} keepingId={keepingId} /> : <div className="mt-6 space-y-8">{sections.upcoming.length > 0 && <RunSection title="Upcoming" runs={sections.upcoming} onRemove={remove} removingId={removingId} onToggleKeep={toggleKeep} keepingId={keepingId} upcoming />}{sections.past.length > 0 && <PastSection runs={sections.past} onRemove={remove} removingId={removingId} onToggleKeep={toggleKeep} keepingId={keepingId} />}</div>}<SoloRunSheet open={soloOpen} onClose={() => setSoloOpen(false)} cityId={cityId} onScheduled={load} /><LogRunSheet open={logRunOpen} onClose={() => setLogRunOpen(false)} /></Page>;
  function remove(run: api.MyRunView) {
    if (removingId) return;
    setRemovingId(run.id); setActionError(null);
    if (run.kind === "solo") {
      // Solo rows are the runner's own private PersonalRun records — DELETE
      // /api/personal-runs/:id. The server resolves the row from the session;
      // nothing here names another caller's record.
      void api.deletePersonalRun(run.id).then((r) => {
        if (r.ok) { toast(`Solo run removed for "${run.title}" on ${formatRunDate(run.date)}.`); load(); }
        else setActionError(r.error.message ?? "Couldn't remove this solo run. Try again.");
        setRemovingId(null);
      });
      return;
    }
    // Remove by the exact attendance row (runId) so one occurrence is never
    // confused with a sibling occurrence of the same event. The server stays
    // authoritative: it resolves the row from the session, never from input.
    void api.rsvpEvent(run.eventId, false, run.date, run.id).then((r) => {
      if (r.ok) { toast(`RSVP removed for "${run.title}" on ${formatRunDate(run.date)}.`); load(); }
      else setActionError(r.error.message ?? "Couldn't remove this RSVP. Try again.");
      setRemovingId(null);
    });
  }
  function toggleKeep(run: api.MyRunView) {
    if (keepingId) return;
    const next = !(run.kept === true);
    setKeepingId(run.id); setActionError(null);
    // "Keep on My Runs" is a server-persisted opt-in: past runs stay in My
    // Runs indefinitely only when kept (or checked in). The server resolves
    // the exact row from the session — never another caller's row.
    void api.keepMyRun(run.id, next).then((r) => {
      if (r.ok) { toast(next ? `"${run.title}" will stay on My Runs.` : `"${run.title}" won't stay on My Runs anymore.`); load(); }
      else setActionError(r.error.message ?? "Couldn't update this run. Try again.");
      setKeepingId(null);
    });
  }
}
function RunSection({ title, runs, onRemove, removingId, onToggleKeep, keepingId, upcoming = false }: { title: string; runs: api.MyRunView[]; onRemove: (r: api.MyRunView) => void; removingId?: string | null; onToggleKeep: (r: api.MyRunView) => void; keepingId?: string | null; upcoming?: boolean }) { return <section aria-labelledby={`my-runs-${title.toLowerCase()}`}><h2 id={`my-runs-${title.toLowerCase()}`} className="text-lg font-extrabold">{title}</h2><div className="mt-3 space-y-3">{runs.map((run) => <RunCard key={run.id} run={run} onRemove={onRemove} removing={removingId === run.id} upcoming={upcoming} onToggleKeep={onToggleKeep} keeping={keepingId === run.id} />)}</div></section>; }
/** Past history, grouped by month in a collapsed accordion (native disclosure).
 * Months collapse by default; each group is an independent toggle. */
export function PastSection({ runs, onRemove, removingId, onToggleKeep, keepingId }: { runs: api.MyRunView[]; onRemove: (r: api.MyRunView) => void; removingId?: string | null; onToggleKeep: (r: api.MyRunView) => void; keepingId?: string | null }) { const groups = groupRunsByMonth(runs); return <section aria-labelledby="my-runs-past"><h2 id="my-runs-past" className="text-lg font-extrabold">Past</h2><p className="mt-1 text-sm text-slate-500">Runs you checked in to or kept on My Runs. Past runs you didn’t keep stay off this list.</p><div className="mt-3 space-y-2">{groups.map(({ key, label, runs: monthRuns }) => <details key={key} data-month={key} className="rounded-2xl bg-white shadow-sm ring-1 ring-slate-200"><summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-2xl px-4 py-3 text-sm font-extrabold [&::-webkit-details-marker]:hidden"><span>{label}</span><span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-500">{monthRuns.length} {monthRuns.length === 1 ? "run" : "runs"}</span></summary><div className="space-y-3 p-4 pt-1">{monthRuns.map((run) => <RunCard key={run.id} run={run} onRemove={onRemove} removing={removingId === run.id} onToggleKeep={onToggleKeep} keeping={keepingId === run.id} />)}</div></details>)}</div></section>; }
export function RunCard({ run, onRemove, removing = false, upcoming = false, onToggleKeep, keeping = false }: { run: api.MyRunView; onRemove: (r: api.MyRunView) => void; removing?: boolean; upcoming?: boolean; onToggleKeep?: (r: api.MyRunView) => void; keeping?: boolean }) {
  const kind = run.kind ?? "rsvp"; const kept = run.kept === true; const checkedIn = run.checkedIn === true; const isSolo = kind === "solo";
  const removeLabel = isSolo ? `Remove solo run for ${run.title}` : `Remove RSVP for ${run.title}`;
  const meta = <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{formatRunDate(run.date)} · {run.time}</p>;
  const body = upcoming ? (isSolo ? <><p className="text-xs font-bold uppercase tracking-wide text-[#FF5741]">{formatRunDate(run.date)} · {run.time}</p><h3 className="mt-1 break-words font-extrabold">{run.title}</h3><p className="mt-1 text-sm text-slate-500">{run.location || "No location set"}{run.distanceLabel ? ` · ${run.distanceLabel}` : ""}</p><p className="mt-2 text-xs text-slate-500">Your private solo run. Nobody else sees it.</p></> : <><Link to={`/events/${run.eventId}`} className="block rounded-lg focus-visible:outline-none"><p className="text-xs font-bold uppercase tracking-wide text-[#FF5741]">{formatRunDate(run.date)} · {run.time}</p><h3 className="mt-1 break-words font-extrabold">{run.title}</h3><p className="mt-1 text-sm text-slate-500">{run.location}</p><span className="mt-3 inline-block text-xs font-bold text-[#14171C]">View run details →</span></Link><Link to={`/events/${run.eventId}?discussion=${encodeURIComponent(run.occurrenceId ?? "")}`} className="mt-2 block text-xs font-bold text-sky-800">Run-day discussion →</Link></>) : <>{meta}<h3 className="mt-1 break-words font-extrabold">{run.title}</h3><p className="mt-1 text-sm text-slate-500">{run.location || "Location unavailable"}{run.distanceLabel ? ` · ${run.distanceLabel}` : ""}</p>{checkedIn ? <p className="mt-2 text-xs font-bold text-[#FF5741]">Checked in</p> : null}<p className="mt-2 text-xs text-slate-500">{isSolo ? "This solo run is preserved in your history." : "This RSVP is preserved in your history. Public event details are no longer available."}</p></>;
  return <article className={`rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 ${upcoming ? "hover:ring-slate-400" : ""}`}><div className="flex items-start justify-between gap-3"><div className="min-w-0 flex-1">{body}<label className="mt-3 flex items-center gap-2 text-xs font-bold text-slate-600"><input type="checkbox" role="switch" aria-label={`Keep ${run.title} on My Runs`} checked={kept} disabled={keeping} onChange={() => onToggleKeep?.(run)} className="h-4 w-4 accent-[#FF5741]" />Keep on My Runs</label></div><button aria-label={removeLabel} onClick={() => onRemove(run)} disabled={removing} className={`min-h-11 shrink-0 rounded-[10px] bg-slate-100 px-4 py-2 text-xs font-bold ${removing ? "cursor-default text-slate-400" : "text-slate-700"}`}>{removing ? "Removing…" : "Remove"}</button></div></article>;
}
/** My Runs page header: title block, the "Add solo run" scheduling entry,
 * List/Calendar view toggle, and the private ICS export link. The export is a
 * same-origin download of the caller's OWN upcoming rows (never past history)
 * carrying the browser's UTC offset so the exported "upcoming" set matches the
 * List view (see my-runs-eleventh tests).
 * The date-stamped download name mirrors the server's Content-Disposition so
 * re-exports never collide on import (ical.ts). */
export function MyRunsHeader({ view, onViewChange, onAddSolo, onLogRun }: { view: View; onViewChange: (v: View) => void; onAddSolo: () => void; onLogRun: () => void }) {
  const now = new Date();
  const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return (
    <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-start" data-tour-target="my-runs-header">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">My Runs</h1>
        <p className="mt-2 text-sm text-slate-500">Your private RSVP list. Only you can see it.</p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <button type="button" onClick={onLogRun} aria-label="Log a run" title="Record a completed run — it shows as an activity card on your public profile" className="inline-flex min-h-11 items-center gap-1.5 rounded-[10px] bg-[#FF5741] px-3 py-2 text-xs font-bold text-[#14171C] shadow-sm hover:bg-[#e94735]"><Icon name="plus" className="h-3.5 w-3.5" />Log a run</button>
        <button type="button" onClick={onAddSolo} aria-label="Add solo run" title="Schedule a private run just for you — only you can see it" className="inline-flex min-h-11 items-center gap-1.5 rounded-[10px] bg-[#14171C] px-3 py-2 text-xs font-bold text-white shadow-sm hover:bg-[#252a31]"><Icon name="plus" className="h-3.5 w-3.5" />Add solo run</button>
        <a href={`/api/my/runs/ical?tzOffsetMinutes=${new Date().getTimezoneOffset()}`} download={`runlocal-my-runs-${stamp}.ics`} aria-label="Export calendar (.ics)" title="Download your upcoming runs as an .ics calendar file (Google, Outlook, Apple compatible)" className="inline-flex min-h-11 items-center rounded-[10px] bg-white px-3 py-2 text-xs font-bold text-[#14171C] shadow-sm ring-1 ring-slate-200 hover:ring-slate-400">Export calendar (.ics)</a>
        <div className="flex shrink-0 rounded-xl bg-slate-100 p-1" role="group" aria-label="My Runs view">
          <button type="button" aria-pressed={view === "list"} onClick={() => onViewChange("list")} className={`min-h-11 rounded-lg px-3 py-2 text-xs font-bold ${view === "list" ? "bg-white shadow-sm" : "text-slate-500"}`}>List</button>
          <button type="button" aria-pressed={view === "calendar"} onClick={() => onViewChange("calendar")} className={`min-h-11 rounded-lg px-3 py-2 text-xs font-bold ${view === "calendar" ? "bg-white shadow-sm" : "text-slate-500"}`}>Calendar</button>
        </div>
      </div>
    </div>
  );
}

/** Month calendar grid (Monday-first) of UPCOMING runs only, with accessible
 * day states (today via aria-current, selected via aria-pressed, run counts in
 * each day's aria-label) and a day panel that reuses RunCard so remove/keep
 * work exactly like the List view. Occurrence-exact: every upcoming RSVP row is
 * its own entry, linked to its own occurrence discussion. Past history stays in
 * the List view — the grid never renders past runs. */
export function CalendarGrid({ upcoming, onRemove, removingId, onToggleKeep, keepingId, now = new Date() }: { upcoming: api.MyRunView[]; onRemove: (r: api.MyRunView) => void; removingId?: string | null; onToggleKeep?: (r: api.MyRunView) => void; keepingId?: string | null; now?: Date }) {
  const upcomingOnly = useMemo(() => upcoming.filter((r) => runStartMs(r) >= now.getTime()), [upcoming, now]);
  // Open on the month of the earliest upcoming run (current month when none),
  // so an upcoming-only grid never starts on an empty dead-end month.
  const [cursor, setCursor] = useState(() => defaultCalendarMonth(upcomingOnly, now));
  const [selected, setSelected] = useState<string | null>(null);
  // Single pending-focus channel: "YYYY-MM-DD" (a day button) or "#day-panel"
  // (the day-panel heading/message). Month changes, keyboard day nav, and the
  // post-removal auto-advance all route focus here after render.
  const pendingFocusRef = useRef<string | null>(null);
  const lastRunDayRef = useRef<string | null>(null);
  const year = Number(cursor.slice(0, 4));
  const monthIndex = Number(cursor.slice(5, 7)) - 1;
  const runsByDate = useMemo(() => {
    const map = new Map<string, api.MyRunView[]>();
    for (const run of upcomingOnly) {
      if (run.date.length !== 10 || !run.date.startsWith(cursor)) continue;
      const bucket = map.get(run.date) ?? [];
      bucket.push(run);
      map.set(run.date, bucket);
    }
    for (const bucket of map.values()) bucket.sort((a, b) => a.time.localeCompare(b.time) || a.id.localeCompare(b.id));
    return map;
  }, [upcomingOnly, cursor]);
  const days = calendarGridDays(year, monthIndex);
  const today = now.toISOString().slice(0, 10);
  const activeDate = selected ?? defaultCalendarDay(upcomingOnly, now, cursor);
  const dayRuns = activeDate ? (runsByDate.get(activeDate) ?? []) : [];
  // When the displayed month has no runs, point forward at the next month with one.
  const nextRun = upcomingOnly.find((r) => r.date.slice(0, 7) > cursor);
  // Roving tabindex: the active day, else today's cell when in month, else the
  // first in-month day — exactly one day button is tabbable at all times.
  const focusableDate = activeDate ?? days.find((d) => d.inMonth && d.date === today)?.date ?? days.find((d) => d.inMonth)!.date;
  // Auto-advance: removing the selected day's LAST run re-derives the panel to
  // the next meaningful day instead of stranding the user on an empty one. The
  // identity guard (lastRunDayRef) keeps exploration of an already-empty day
  // from resetting the selection; removing one of several runs stays put.
  useEffect(() => {
    if (dayRuns.length > 0) {
      lastRunDayRef.current = selected;
    } else if (selected && lastRunDayRef.current === selected) {
      lastRunDayRef.current = null;
      setSelected(null); // activeDate falls back to defaultCalendarDay → next run day, or null → empty-month message
      pendingFocusRef.current = defaultCalendarDay(upcomingOnly, now, cursor) ?? "#day-panel";
    }
  }, [dayRuns, selected]);
  useEffect(() => {
    const target = pendingFocusRef.current;
    if (!target) return;
    pendingFocusRef.current = null;
    requestAnimationFrame(() => {
      const el = target === "#day-panel"
        ? document.querySelector('[data-day-panel-focus]')
        : document.querySelector(`[data-date="${target}"]`);
      (el as HTMLElement | null)?.focus();
    });
  }, [cursor, selected]);
  const changeMonth = (delta: number) => {
    const d = new Date(Date.UTC(year, monthIndex + delta, 1));
    const nextCursor = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    setCursor(nextCursor);
    setSelected(null);
    // Focus lands on the new month's active day (or its first day when empty).
    pendingFocusRef.current = defaultCalendarDay(upcomingOnly, now, nextCursor) ?? firstInMonthDay(nextCursor);
  };
  const handleDayKeyDown = (e: React.KeyboardEvent, date: string) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    const nav = navigateDay(date, e.key as NavKey);
    if (nav.monthChanged) setCursor(nav.date.slice(0, 7));
    setSelected(nav.date);
    pendingFocusRef.current = nav.date;
  };
  return <div className="mt-6" role="group" aria-label="My Runs calendar"><div className="flex items-center gap-3"><div className="flex items-center gap-1"><button type="button" aria-label="Previous month" onClick={() => changeMonth(-1)} disabled={cursor <= monthKey(now.toISOString().slice(0, 10))} className="flex h-11 w-11 items-center justify-center rounded-xl bg-white text-lg font-bold text-slate-600 shadow-sm ring-1 ring-slate-200 hover:ring-slate-400 disabled:cursor-default disabled:text-slate-300 disabled:ring-slate-100">‹</button><button type="button" aria-label="Next month" onClick={() => changeMonth(1)} className="flex h-11 w-11 items-center justify-center rounded-xl bg-white text-lg font-bold text-slate-600 shadow-sm ring-1 ring-slate-200 hover:ring-slate-400">›</button></div><h2 aria-live="polite" className="text-sm font-extrabold uppercase tracking-wide text-slate-500">{monthLabel(cursor)}</h2></div><p className="mt-2 text-xs text-slate-400">Upcoming runs only — past history stays in the List view.</p><div className="mt-3 grid grid-cols-7 gap-1">{WEEKDAY_LABELS.map((label) => <div key={label} aria-hidden="true" className="pb-1 text-center text-[10px] font-extrabold uppercase tracking-wide text-slate-400">{label}</div>)}{days.map((cell, i) => cell.inMonth ? (() => { const count = runsByDate.get(cell.date)?.length ?? 0; const isToday = cell.date === today; const isActive = activeDate === cell.date; return <button key={cell.date} type="button" data-date={cell.date} onClick={() => setSelected(cell.date)} aria-pressed={isActive} aria-current={isToday ? "date" : undefined} aria-label={dayAriaLabel(cell.date, count)} tabIndex={cell.date === focusableDate ? 0 : -1} onKeyDown={(e) => handleDayKeyDown(e, cell.date)} className={`flex min-h-11 flex-col items-center justify-center rounded-xl text-sm font-bold shadow-sm ring-1 ring-slate-200 ${isActive ? "bg-[#14171C] text-white ring-[#14171C]" : isToday ? "bg-[#FF5741]/10 text-[#14171C] ring-2 ring-[#FF5741]" : "bg-white text-slate-700 hover:ring-slate-400"}`}><span>{cell.dayOfMonth}</span>{count > 0 ? <span aria-hidden="true" className={`mt-0.5 text-[9px] font-extrabold leading-none ${isActive ? "text-white/70" : "text-[#FF5741]"}`}>{count}</span> : null}{isToday ? <span className="sr-only">Today</span> : null}</button>; })() : <span key={`fill-${i}`} aria-hidden="true" className="min-h-11 rounded-xl" />)}</div><section aria-label="Runs on the selected day" className="mt-5">{activeDate ? <><h3 tabIndex={-1} data-day-panel-focus className="text-sm font-extrabold uppercase tracking-wide text-slate-500 focus:outline-none">{formatRunDate(activeDate)}{activeDate === today ? <span className="ml-2 rounded-full bg-[#FF5741]/15 px-2 py-0.5 text-[10px] font-extrabold uppercase text-[#14171C]">Today</span> : null}</h3>{dayRuns.length > 0 ? <div className="mt-3 space-y-3">{dayRuns.map((run) => <RunCard key={run.id} run={run} onRemove={onRemove} removing={removingId === run.id} upcoming onToggleKeep={onToggleKeep} keeping={keepingId === run.id} />)}</div> : <p tabIndex={-1} data-day-panel-focus className="mt-3 text-sm text-slate-500 focus:outline-none">No runs on this day.</p>}</> : <p tabIndex={-1} data-day-panel-focus className="mt-3 text-sm text-slate-500 focus:outline-none">No upcoming runs this month. Past runs you kept or checked in to stay in the List view.{nextRun ? ` Your next RSVP is in ${monthLabel(nextRun.date.slice(0, 7))}.` : ""}</p>}</section></div>;
}
function Empty() { return <div className="mt-10 text-center"><Icon name="calendar" className="mx-auto h-10 w-10 text-slate-300"/><p className="mt-3 font-semibold">No RSVPs yet</p><p className="mt-1 text-sm text-slate-500">Runs you RSVP to will appear here, with past history kept private.</p><Link className="mt-4 inline-flex min-h-11 items-center rounded-lg px-4 py-2 text-sm font-bold text-[#14171C] ring-1 ring-slate-200" to="/">Browse this week's runs</Link></div>; }
function Page({ children }: { children: React.ReactNode }) { return <div className="my-runs-page mx-auto w-full max-w-[42rem] px-4 pb-32 pt-8 md:px-6"><div className="mb-5 flex items-center gap-2"><Icon name="rsvp" className="h-5 w-5 text-[#FF5741]"/><span className="text-xs font-bold uppercase tracking-widest text-slate-400">Private</span></div>{children}</div>; }
