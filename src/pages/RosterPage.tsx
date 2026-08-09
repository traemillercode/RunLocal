/**
 * Organizer check-in roster (`/#/groups/:groupId/roster?eventId=..&occurrenceId=..`).
 *
 * Private to the group's verified leaders (server-enforced). Shows the RSVP
 * roster for ONE occurrence with each runner's check-in state and their
 * group-waiver status — a missing/expired waiver renders as an amber warning
 * and never blocks check-in. Leaders can check runners in / undo, and can
 * generate the new-runner QR session for this occurrence (the QR encodes a
 * link into the mobile flow at /#/checkin).
 */
import { useCallback, useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import * as api from "../lib/api";
import { Icon } from "../components/ui";

/** Presentational row — no hooks — so UI tests can assert the warning + enabled button. */
export function RosterRowView({ row, busy, onCheckIn, onUndo }: { row: api.RosterRow; busy: boolean; onCheckIn: () => void; onUndo: () => void }) {
  const waiverMissing = row.waiver.status === "unsigned" || row.waiver.status === "expired";
  return (
    <li className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/70">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-bold text-slate-900">{row.name}</p>
          <p className="truncate text-xs text-slate-500">{row.username ? `@${row.username}` : "No username yet"}</p>
          {waiverMissing ? (
            <p className="mt-1.5 text-xs font-semibold text-amber-700">
              Waiver {row.waiver.status === "expired" ? "expired" : "not signed"} — remind to sign
            </p>
          ) : (
            <p className="mt-1.5 text-xs font-semibold text-emerald-700">Waiver {row.waiver.status === "signed" ? "signed" : "not required"}</p>
          )}
        </div>
        {row.checkedIn ? (
          <div className="text-right">
            <p className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-3 py-1.5 text-xs font-bold text-emerald-800"><Icon name="check" className="h-3 w-3" /> Checked in</p>
            <button type="button" onClick={onUndo} disabled={busy} className="mt-1.5 block text-xs font-semibold text-slate-400 underline disabled:opacity-50">Undo</button>
          </div>
        ) : (
          <button type="button" onClick={onCheckIn} disabled={busy} className="rounded-full bg-emerald-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-60">
            Check in
          </button>
        )}
      </div>
    </li>
  );
}

/** Presentational QR panel — displays the code once a session exists. */
export function QrPanelView({ qrUrl, expiresAt, busy, onGenerate }: { qrUrl: string | null; expiresAt: string | null; busy: boolean; onGenerate: () => void }) {
  return (
    <section aria-label="New-runner QR" className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70">
      <h2 className="font-extrabold">New-runner QR</h2>
      <p className="mt-1 text-sm text-slate-600">Show this code so runners can join, sign the waiver, and check in on their phone for this run. It expires after a few hours and only grants each runner their own check-in.</p>
      {qrUrl ? (
        <div className="mt-4 flex flex-col items-center gap-2">
          <img src={qrUrl} alt="QR code for runner check-in" width={220} height={220} className="rounded-xl ring-1 ring-slate-200" />
          {expiresAt ? <p className="text-xs text-slate-500">Valid through {new Date(expiresAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</p> : null}
          <button type="button" onClick={onGenerate} disabled={busy} className="mt-1 text-sm font-bold text-emerald-800 underline disabled:opacity-50">Generate a fresh code</button>
        </div>
      ) : (
        <button type="button" onClick={onGenerate} disabled={busy} className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-[10px] bg-[#14171C] text-sm font-bold text-white disabled:opacity-60">
          <Icon name="spark" className="h-4 w-4 text-[#FF5741]" /> Generate QR
        </button>
      )}
    </section>
  );
}

export function RosterPage() {
  const { groupId = "" } = useParams();
  const [searchParams] = useSearchParams();
  const eventId = searchParams.get("eventId") ?? "";
  const occurrenceId = searchParams.get("occurrenceId") ?? "";
  const [view, setView] = useState<api.RosterView | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [qrExpiresAt, setQrExpiresAt] = useState<string | null>(null);
  const [qrError, setQrError] = useState("");

  const load = useCallback(() => {
    if (!groupId || !eventId || !occurrenceId) { setError("This roster link is missing its run details."); return; }
    setError("");
    void api.getRoster(groupId, eventId, occurrenceId).then((r) => {
      if (r.ok) setView(r.data);
      else if (r.error.status === 403) setError("Only this group's verified leaders can view the roster.");
      else setError(r.error.message ?? "We couldn't load the roster.");
    });
  }, [groupId, eventId, occurrenceId]);
  useEffect(load, [load]);

  const checkedCount = view?.roster.filter((r) => r.checkedIn).length ?? 0;

  const doCheckIn = (row: api.RosterRow) => {
    if (busy) return; setBusy(true);
    void api.leaderCheckin(groupId, eventId, occurrenceId, row.accountId).then((r) => {
      setBusy(false);
      if (!r.ok) { setError(r.error.message ?? "Couldn't check that runner in."); return; }
      setView((v) => v ? { ...v, roster: v.roster.map((x) => x.accountId === row.accountId ? { ...x, checkedIn: true, checkedInAt: r.data.checkin.checkedInAt, checkedInBy: r.data.checkin.checkedInBy } : x) } : v);
    });
  };
  const doUndo = (row: api.RosterRow) => {
    if (busy) return; setBusy(true);
    void api.leaderUndoCheckin(groupId, eventId, occurrenceId, row.accountId).then((r) => {
      setBusy(false);
      if (!r.ok) { setError(r.error.message ?? "Couldn't undo that check-in."); return; }
      setView((v) => v ? { ...v, roster: v.roster.map((x) => x.accountId === row.accountId ? { ...x, checkedIn: false, checkedInAt: null, checkedInBy: null } : x) } : v);
    });
  };
  const generateQr = () => {
    if (busy) return; setBusy(true); setQrError("");
    void api.createQrSession(groupId, eventId, occurrenceId).then(async (r) => {
      setBusy(false);
      if (!r.ok) { setQrError(r.error.message ?? "Couldn't create the QR code."); return; }
      setQrExpiresAt(r.data.session.expiresAt);
      const link = `${window.location.origin}${window.location.pathname}#/checkin?t=${encodeURIComponent(r.data.session.token)}`;
      try {
        const QRCode = (await import("qrcode")).default;
        const url = await QRCode.toDataURL(link, { width: 220, margin: 1, errorCorrectionLevel: "M" });
        setQrUrl(url);
      } catch {
        setQrError("The QR image couldn't be generated, but runners can still open this link directly: " + link);
      }
    });
  };

  if (error) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-10 text-center">
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-slate-100 text-slate-400"><Icon name="rsvp" className="h-7 w-7" /></span>
        <h1 className="mt-3 text-xl font-extrabold">Roster unavailable</h1>
        <p className="mx-auto mt-1 max-w-sm text-sm text-slate-500">{error}</p>
        <Link to="/my-groups" className="mt-4 inline-block rounded-[10px] bg-[#14171C] px-5 py-3 text-sm font-semibold text-white">My groups</Link>
      </div>
    );
  }
  if (!view) {
    return <div className="mx-auto w-full max-w-3xl px-4 py-10 text-center text-sm text-slate-500">Loading roster…</div>;
  }
  return (
    <section className="mx-auto w-full max-w-3xl px-4 py-6 pb-32">
      <p className="text-xs font-bold uppercase tracking-widest text-orange-700">Organizer</p>
      <h1 className="mt-2 text-3xl font-black">{view.event.title}</h1>
      <p className="mt-1 text-sm text-slate-600">{view.event.groupName} · {new Date(view.event.startsAt).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} · {view.event.time} · {view.event.location}</p>
      <p className="mt-3 text-sm font-bold">Checked in {checkedCount} of {view.roster.length}</p>
      {qrError ? <p role="alert" className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">{qrError}</p> : null}
      <div className="mt-4 grid gap-4">
        <QrPanelView qrUrl={qrUrl} expiresAt={qrExpiresAt} busy={busy} onGenerate={generateQr} />
        <section aria-label="RSVP roster" className="rounded-2xl bg-slate-50 p-5">
          <h2 className="font-extrabold">RSVP roster</h2>
          <p className="mt-1 text-xs text-slate-500">Private to group leaders. Waiver warnings never block check-in.</p>
          {view.roster.length === 0 ? (
            <p className="mt-4 text-sm text-slate-500">No RSVPs yet for this run.</p>
          ) : (
            <ul className="mt-3 grid gap-3">
              {view.roster.map((row) => (
                <RosterRowView key={row.accountId} row={row} busy={busy} onCheckIn={() => doCheckIn(row)} onUndo={() => doUndo(row)} />
              ))}
            </ul>
          )}
        </section>
      </div>
    </section>
  );
}
