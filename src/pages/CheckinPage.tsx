/**
 * Mobile QR check-in flow (`/#/checkin?t=<token>`).
 *
 * A runner scans the organizer's QR code on their phone; this page peeks the
 * session (guest-safe), then lets the verified runner, for THIS occurrence
 * only: join (RSVP), review + sign the group's current waiver, and check
 * themselves in. The waiver is shown as a warning when unsigned/expired — it
 * never blocks check-in. All authorization and occurrence binding are
 * server-side; the token grants no leader powers and never exposes the roster.
 */
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import * as api from "../lib/api";
import { useAccount } from "../state/account";
import { Icon } from "../components/ui";

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) + " · " + d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function WaiverBadge({ waiver }: { waiver: api.WaiverState }) {
  if (waiver.status === "signed") {
    return <p className="text-sm font-semibold text-emerald-700">Waiver signed{waiver.expiresAt ? ` through ${new Date(waiver.expiresAt).toLocaleDateString()}` : ""}</p>;
  }
  if (waiver.status === "unsigned" || waiver.status === "expired") {
    return <p className="text-sm font-semibold text-amber-700">Waiver {waiver.status === "unsigned" ? "not signed yet" : "expired"} — signing is recommended, but it won't block your check-in.</p>;
  }
  return <p className="text-sm text-slate-500">This group has no current waiver.</p>;
}

/** Presentational body — no hooks — so UI tests can render real markup. */
export function CheckinFlowView({
  session,
  me,
  busy,
  notice,
  onJoin,
  onSign,
  onCheckin,
  onBack,
}: {
  session: api.CheckinSessionView["session"];
  me: api.CheckinSessionView["me"];
  busy: boolean;
  notice: string;
  onJoin: () => void;
  onSign: () => void;
  onCheckin: () => void;
  onBack: () => void;
}) {
  return (
    <div className="mx-auto w-full max-w-md px-4 pb-12 pt-6">
      <button type="button" onClick={onBack} className="mb-3 flex items-center gap-1 text-[13px] font-semibold text-slate-500">
        <Icon name="chevronRight" className="h-4 w-4 rotate-180" /> Back
      </button>
      <article className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/70">
        <div className="bg-[#14171C] p-5 text-white">
          <p className="text-[12px] font-bold uppercase tracking-wider text-[#FF5741]">Organizer check-in · {session.event.groupName}</p>
          <h1 className="mt-2 text-2xl font-extrabold leading-tight tracking-tight">{session.event.title}</h1>
          <p className="mt-1.5 text-sm font-medium text-white/75">{formatTime(session.event.startsAt)} · {session.event.location}</p>
        </div>
        <div className="space-y-4 p-5">
          {notice ? <p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">{notice}</p> : null}
          <section aria-label="Join">
            <h2 className="text-sm font-extrabold uppercase tracking-wider text-slate-400">Join</h2>
            {me?.rsvped ? (
              <p className="mt-2 rounded-xl bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">You're on the list for this run.</p>
            ) : (
              <button
                type="button"
                onClick={onJoin}
                disabled={busy}
                className="mt-2 inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-full bg-[#FF5741] text-sm font-semibold text-[#14171C] disabled:opacity-60"
              >
                <Icon name="rsvp" className="h-4 w-4" /> Join this run
              </button>
            )}
          </section>
          <section aria-label="Waiver">
            <h2 className="text-sm font-extrabold uppercase tracking-wider text-slate-400">Waiver</h2>
            <div className="mt-2 rounded-xl bg-slate-50 p-3">
              <WaiverBadge waiver={me?.waiver ?? { status: "not_required", version: null, expiresAt: null }} />
              {me?.waiver && (me.waiver.status === "unsigned" || me.waiver.status === "expired") ? (
                <button
                  type="button"
                  onClick={onSign}
                  disabled={busy}
                  className="mt-3 inline-flex min-h-10 w-full items-center justify-center rounded-[10px] bg-[#14171C] px-4 text-sm font-bold text-white disabled:opacity-60"
                >
                  Sign current waiver
                </button>
              ) : null}
            </div>
          </section>
          <section aria-label="Check in">
            <h2 className="text-sm font-extrabold uppercase tracking-wider text-slate-400">Check in</h2>
            {me?.checkedIn ? (
              <p className="mt-2 rounded-xl bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">Checked in{me.checkedInAt ? ` at ${new Date(me.checkedInAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}` : ""}. See the organizer — have a great run!</p>
            ) : (
              <button
                type="button"
                onClick={onCheckin}
                disabled={busy}
                className="mt-2 inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-full bg-emerald-600 text-sm font-bold text-white disabled:opacity-60"
              >
                <Icon name="check" className="h-4 w-4" /> Check me in
              </button>
            )}
          </section>
          <p className="text-xs leading-relaxed text-slate-400">This link is for this run only and expires after a few hours. It only lets you join, sign the waiver, and check in for yourself.</p>
        </div>
      </article>
    </div>
  );
}

export function CheckinPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("t") ?? "";
  const { role, refresh } = useAccount();
  const [view, setView] = useState<api.CheckinSessionView | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const load = () => {
    if (!token) { setError("This check-in link is missing its code. Ask the organizer to show the QR again."); return; }
    setError("");
    void api.getCheckinSession(token).then((r) => {
      if (r.ok) setView(r.data);
      else setError(r.error.status === 410 ? (r.error.message ?? "This check-in link has expired.") : r.error.status === 404 ? "This check-in link isn't valid." : r.error.message ?? "We couldn't load this check-in link.");
    });
  };
  useEffect(load, [token]);
  const act = (label: string, run: () => Promise<api.ApiResult<unknown>>) => {
    if (busy) return;
    setBusy(true); setNotice("");
    void run().then((r) => {
      setBusy(false);
      if (!r.ok) { setError(r.error.message ?? "That didn't work — try again."); return; }
      setNotice(label);
      void api.getCheckinSession(token).then((res) => { if (res.ok) setView(res.data); });
    });
  };

  if (error) {
    return (
      <div className="mx-auto w-full max-w-md px-4 pb-12 pt-8 text-center">
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-slate-100 text-slate-400"><Icon name="calendar" className="h-7 w-7" /></span>
        <h1 className="mt-3 text-xl font-extrabold">Check-in unavailable</h1>
        <p className="mt-1 text-sm text-slate-500">{error}</p>
        <Link to="/" className="mt-4 inline-block rounded-[10px] bg-[#14171C] px-5 py-3 text-sm font-semibold text-white">Back to Run Local</Link>
      </div>
    );
  }
  if (!view) {
    return <div className="mx-auto w-full max-w-md px-4 pt-10 text-center text-sm text-slate-500">Loading check-in…</div>;
  }
  if (role === "guest") {
    return (
      <div className="mx-auto w-full max-w-md px-4 pb-12 pt-8 text-center">
        <h1 className="text-xl font-extrabold">{view.session.event.title}</h1>
        <p className="mt-1 text-sm text-slate-500">{view.session.event.groupName} · {formatTime(view.session.event.startsAt)}</p>
        <div className="mt-6 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70">
          <p className="font-bold">Sign in to join and check in</p>
          <p className="mt-1 text-sm text-slate-600">This run uses verified runner accounts. Sign in, then re-open this link (or re-scan the QR) to continue.</p>
          <Link to="/login" className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-full bg-[#FF5741] text-sm font-semibold text-[#14171C]">Sign in</Link>
        </div>
      </div>
    );
  }
  if (role === "pending") {
    return (
      <div className="mx-auto w-full max-w-md px-4 pb-12 pt-8 text-center">
        <h1 className="text-xl font-extrabold">{view.session.event.title}</h1>
        <div className="mt-6 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70">
          <p className="font-bold">Verification required</p>
          <p className="mt-1 text-sm text-slate-600">Only verified runners can join and check in. Finish your profile verification, then re-open this link.</p>
          <Link to="/verify" className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-full bg-[#14171C] text-sm font-semibold text-white">Complete verification</Link>
        </div>
      </div>
    );
  }
  return (
    <CheckinFlowView
      session={view.session}
      me={view.me}
      busy={busy}
      notice={notice}
      onJoin={() => act("You're on the list.", () => api.joinCheckinSession(token))}
      onSign={() => act("Waiver signed — thanks!", () => api.signCheckinWaiver(token))}
      onCheckin={() => act("You're checked in!", () => api.checkinViaSession(token))}
      onBack={() => void refresh().then(() => (window.location.hash = "#/"))}
    />
  );
}
