/**
 * Community submission forms (race / group / independent event). Each form
 * submits to the server-side pending queue — the server is authoritative for
 * every permission and validation. The UI only surfaces server verdicts.
 */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import * as api from "../lib/api";
import { Icon, PillButton, Sheet } from "./ui";
import { useAccount } from "../state/account";
import { useToast } from "../lib/toast";
import { PACE_POLICIES, PACE_POLICY_LABELS } from "../types";

const inputCls =
  "h-11 w-full rounded-xl border border-slate-300 bg-white px-3.5 text-[15px] text-slate-900 outline-none placeholder:text-slate-400 focus:border-[#14171C] focus:ring-2 focus:ring-[#FF5741]/60";
const labelCls = "mb-1.5 block text-sm font-semibold text-slate-700";
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className={labelCls}>{label}</span>
      {children}
    </label>
  );
}

function Err({ msg }: { msg: string | null }) {
  return msg ? <p role="alert" className="mt-1.5 text-xs font-medium text-red-600">{msg}</p> : null;
}

function useSubmit() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (fn: () => Promise<api.ApiResult<unknown>>) => {
    setBusy(true);
    setError(null);
    let r: api.ApiResult<unknown>;
    try {
      r = await fn();
    } catch (err) {
      const message = err instanceof Error ? err.message : "The submission could not be sent. Check your connection and try again.";
      setError(message);
      return false;
    } finally {
      setBusy(false);
    }
    if (r.ok) {
      return true;
    }
    setError(r.error.message ?? "Couldn't submit. Check the highlighted fields.");
    return false;
  };
  return { busy, error, setError, submit };
}

/**
 * Kind-agnostic post-submit success panel — the single confirmation that
 * replaces the old success toast (a message-only toast can't carry a reliable
 * "Track submission" action). onTrack navigates to the profile's My
 * submissions section; onDone just closes the sheet.
 */
export function SubmissionSuccessStep({ onTrack, onDone }: { onTrack: () => void; onDone: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 py-4 text-center">
      <span className="grid h-14 w-14 place-items-center rounded-full bg-emerald-100 text-emerald-700">
        <Icon name="check" className="h-7 w-7" />
      </span>
      <div>
        <h3 className="text-lg font-bold text-slate-900">Submission received</h3>
        <p className="mt-1 text-sm leading-relaxed text-slate-600">
          It's in the review queue — only you can see it until it's approved. You can edit or withdraw it while it's pending.
        </p>
      </div>
      <div className="mt-2 w-full space-y-2">
        <PillButton variant="primary" className="w-full" onClick={onTrack}>
          <Icon name="chevronRight" className="h-4 w-4 rotate-180" /> Track submission
        </PillButton>
        <PillButton variant="ghost" className="w-full" onClick={onDone}>Done</PillButton>
      </div>
    </div>
  );
}

/** Race submission: verified runners / race directors. */
export function RaceSubmissionSheet({ open, onClose, onSubmitted, cityId }: { open: boolean; onClose: () => void; onSubmitted?: () => void; cityId: string }) {
  const { busy, error, submit } = useSubmit();
  const navigate = useNavigate();
  const [done, setDone] = useState(false);
  useEffect(() => { if (open) setDone(false); }, [open]);
  const [f, setF] = useState({ name: "", distances: "", date: "", location: "", registrationUrl: "", description: "" });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    const ok = await submit(() => api.submitRace({ ...f, cityId }));
    if (ok) {
      setF({ name: "", distances: "", date: "", location: "", registrationUrl: "", description: "" });
      setDone(true);
      onSubmitted?.();
    }
  };
  return (
    <Sheet open={open} onClose={onClose} title="Submit a race" subtitle="Verified runners & race directors — pending approval before it's public">
      {done ? (
        <SubmissionSuccessStep onTrack={() => { onClose(); navigate("/profile?section=submissions"); }} onDone={onClose} />
      ) : (
      <div className="space-y-4">
        <Field label="Race name"><input className={inputCls} placeholder="e.g. River 5K" value={f.name} onChange={set("name")} /></Field>
        <Field label="Distances"><input className={inputCls} placeholder="e.g. 5K / 10K" value={f.distances} onChange={set("distances")} /></Field>
        <Field label="Race date"><input type="date" className={inputCls} value={f.date} onChange={set("date")} /></Field>
        <Field label="Location"><input className={inputCls} placeholder="Start line & area" value={f.location} onChange={set("location")} /></Field>
        <Field label="External registration URL"><input className={inputCls} placeholder="https://…" inputMode="url" value={f.registrationUrl} onChange={set("registrationUrl")} /></Field>
        <Field label="Description"><textarea rows={3} className={`${inputCls} h-auto py-2.5`} placeholder="What runners should know…" value={f.description} onChange={set("description")} /></Field>
        <Err msg={error} />
        <PillButton variant="primary" className="w-full" disabled={busy} onClick={() => void save()}>
          <Icon name="check" className="h-4 w-4" /> {busy ? "Submitting…" : "Submit for approval"}
        </PillButton>
        <p className="text-center text-xs text-slate-400">Approved listings appear on the public Races page. Only your own submissions are visible to you.</p>
      </div>
      )}
    </Sheet>
  );
}

/** Group submission: verified runners. RRCA option is a request, not a claim. */
export function GroupSubmissionSheet({ open, onClose, onSubmitted, cityId }: { open: boolean; onClose: () => void; onSubmitted?: () => void; cityId: string }) {
  const { busy, error, setError, submit } = useSubmit();
  const navigate = useNavigate();
  const [done, setDone] = useState(false);
  useEffect(() => { if (open) setDone(false); }, [open]);
  const [uploading, setUploading] = useState(false);
  const [f, setF] = useState({ name: "", description: "", groupType: "community", facebookUrl: "", instagramUrl: "", websiteUrl: "", coverPhoto: "", logoPhoto: "", membershipMode: "request" });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    if (!f.coverPhoto || !f.logoPhoto) {
      setError("Choose both a cover photo and a logo before submitting.");
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const cover = await api.uploadGroupPhoto(f.coverPhoto);
      if (!cover.ok) {
        setError(cover.error.message ?? "Cover photo upload failed. Please choose another image and try again.");
        return;
      }
      const logo = await api.uploadGroupPhoto(f.logoPhoto);
      if (!logo.ok) {
        setError(logo.error.message ?? "Logo photo upload failed. Please choose another image and try again.");
        return;
      }
      const ok = await submit(() =>
        api.submitGroup({
          cityId, name: f.name, description: f.description, groupType: f.groupType as "rrca-chartered" | "community",
          facebookUrl: f.facebookUrl || undefined,
          instagramUrl: f.instagramUrl || undefined, websiteUrl: f.websiteUrl || undefined,
          coverPhoto: cover.data.photoRef, logoPhoto: logo.data.photoRef, membershipMode: f.membershipMode as "open" | "request",
        }),
      );
      if (ok) {
        setF({ name: "", description: "", groupType: "community", facebookUrl: "", instagramUrl: "", websiteUrl: "", coverPhoto: "", logoPhoto: "", membershipMode: "request" });
        setDone(true);
        onSubmitted?.();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Photo upload failed. Check your connection and try again.");
    } finally {
      setUploading(false);
    }
    return;
  };
  return (
    <Sheet open={open} onClose={onClose} title="Start a group" subtitle="Verified runners — pending approval before it's public">
      {done ? (
        <SubmissionSuccessStep onTrack={() => { onClose(); navigate("/profile?section=submissions"); }} onDone={onClose} />
      ) : (
      <div className="space-y-4">
        <Field label="Group name"><input className={inputCls} placeholder="e.g. Downtown Runners" value={f.name} onChange={set("name")} /></Field>
        <Field label="Description"><textarea rows={2} className={`${inputCls} h-auto py-2.5`} placeholder="Who you are and what you run" value={f.description} onChange={set("description")} /></Field>
        <Field label="Group type">
          <select className={inputCls} value={f.groupType} onChange={set("groupType")}>
            <option value="community">Community Run Group</option>
            <option value="rrca-chartered">RRCA-Chartered Club</option>
          </select>
        </Field>
        {f.groupType === "rrca-chartered" ? (
          <p className="flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-[12px] leading-relaxed text-amber-900">
            <Icon name="lock" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Choosing “RRCA-Chartered Club” is a request only: an admin verifies the charter before the label is ever shown publicly, and may adjust it.
          </p>
        ) : null}
        <Field label="Facebook link (optional)"><input className={inputCls} placeholder="https://facebook.com/…" inputMode="url" value={f.facebookUrl} onChange={set("facebookUrl")} /></Field>
        <Field label="Instagram link (optional)"><input className={inputCls} placeholder="https://instagram.com/…" inputMode="url" value={f.instagramUrl} onChange={set("instagramUrl")} /></Field>
        <Field label="Membership mode">
          <select className={inputCls} value={f.membershipMode} onChange={set("membershipMode")}>
            <option value="request">Request to join</option><option value="open">Open membership</option>
          </select>
        </Field>
        <Field label="Cover photo (required)"><input type="file" accept="image/jpeg,image/png,image/webp" className={inputCls} onChange={(e) => { const file = e.target.files?.[0]; if (file) { const reader = new FileReader(); reader.onload = () => setF({ ...f, coverPhoto: String(reader.result) }); reader.readAsDataURL(file); } }} /></Field>
        <Field label="Logo photo (required)"><input type="file" accept="image/jpeg,image/png,image/webp" className={inputCls} onChange={(e) => { const file = e.target.files?.[0]; if (file) { const reader = new FileReader(); reader.onload = () => setF({ ...f, logoPhoto: String(reader.result) }); reader.readAsDataURL(file); } }} /></Field>
        <Err msg={error} />
        <PillButton variant="primary" className="w-full" disabled={busy || uploading} onClick={() => void save()}>
          <Icon name="check" className="h-4 w-4" /> {uploading ? "Uploading photos…" : busy ? "Submitting…" : "Submit for approval"}
        </PillButton>
        <p className="text-center text-xs text-slate-400">Once approved, you're granted the Group Leader role for this group.</p>
      </div>
      )}
    </Sheet>
  );
}

/** Independent event submission: verified runners WITHOUT the Group Leader role. */
export function IndependentEventSheet({ open, onClose, onSubmitted, cityId }: { open: boolean; onClose: () => void; onSubmitted?: () => void; cityId: string }) {
  const { me } = useAccount();
  const { busy, error, submit } = useSubmit();
  const navigate = useNavigate();
  const [done, setDone] = useState(false);
  useEffect(() => { if (open) setDone(false); }, [open]);
  const [f, setF] = useState({ type: "recurring", title: "", date: "", dayOfWeek: "0", time: "6:00 PM", location: "", distanceLabel: "", pacePolicy: "", invite: "Open to all", externalUrl: "", description: "" });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const isGroupLeader = me?.status === "signed_in" && me.account.role === "group_leader";
  const save = async () => {
    const ok = await submit(() =>
      api.submitEvent({
        cityId, type: f.type as "one_time" | "recurring", title: f.title,
        date: f.type === "one_time" ? f.date || null : null,
        dayOfWeek: f.type === "recurring" ? Number(f.dayOfWeek) : null,
        time: f.time, location: f.location, distanceLabel: f.distanceLabel, pacePolicy: f.pacePolicy || null, invite: f.invite,
        externalUrl: f.externalUrl || undefined, description: f.description,
      }),
    );
    if (ok) {
      setF({ type: "recurring", title: "", date: "", dayOfWeek: "0", time: "6:00 PM", location: "", distanceLabel: "", pacePolicy: "", invite: "Open to all", externalUrl: "", description: "" });
      setDone(true);
      onSubmitted?.();
    }
  };
  return (
    <Sheet open={open} onClose={onClose} title="Host an independent run" subtitle="Not tied to a group — host shows as Independent Runner">
      {done ? (
        <SubmissionSuccessStep onTrack={() => { onClose(); navigate("/profile?section=submissions"); }} onDone={onClose} />
      ) : (
      <div className="space-y-4">
        {isGroupLeader ? (
          <p className="flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-[12px] leading-relaxed text-amber-900">
            <Icon name="lock" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Group Leaders submit runs through their group's event path — independent runs are for verified runners who aren't group leaders.
          </p>
        ) : null}
        <Field label="Schedule">
          <div className="flex gap-2">
            <button type="button" onClick={() => setF({ ...f, type: "recurring" })} className={`h-11 flex-1 rounded-xl text-sm font-semibold ${f.type === "recurring" ? "bg-[#14171C] text-white" : "bg-slate-100 text-slate-600"}`}>Recurring (weekly)</button>
            <button type="button" onClick={() => setF({ ...f, type: "one_time" })} className={`h-11 flex-1 rounded-xl text-sm font-semibold ${f.type === "one_time" ? "bg-[#14171C] text-white" : "bg-slate-100 text-slate-600"}`}>One-time</button>
          </div>
        </Field>
        <Field label="Run title"><input className={inputCls} placeholder="e.g. Thursday Hills" value={f.title} onChange={set("title")} /></Field>
        {f.type === "recurring" ? (
          <Field label="Day of the week">
            <select className={inputCls} value={f.dayOfWeek} onChange={set("dayOfWeek")}>
              {DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
            </select>
          </Field>
        ) : (
          <Field label="Date"><input type="date" className={inputCls} value={f.date} onChange={set("date")} /></Field>
        )}
        <Field label="Time"><input className={inputCls} placeholder="6:00 PM" value={f.time} onChange={set("time")} /></Field>
        <Field label="Location"><input className={inputCls} placeholder="Meeting spot" value={f.location} onChange={set("location")} /></Field>
        <Field label="Distance"><input className={inputCls} placeholder="e.g. 3–5 mi" value={f.distanceLabel} onChange={set("distanceLabel")} /></Field>
        <Field label="Pace">
          <select className={inputCls} value={f.pacePolicy} onChange={set("pacePolicy")}>
            <option value="">Not specified</option>
            {PACE_POLICIES.map((p) => <option key={p} value={p}>{PACE_POLICY_LABELS[p]}</option>)}
          </select>
        </Field>
        <Field label="Invite">
          <select className={inputCls} value={f.invite} onChange={set("invite")}>
            <option>Open to all</option>
            <option>Members + guests</option>
            <option>RSVP requested</option>
          </select>
        </Field>
        <Field label="External link (optional)"><input className={inputCls} placeholder="https://…" inputMode="url" value={f.externalUrl} onChange={set("externalUrl")} /></Field>
        <Field label="Description (optional)"><textarea rows={2} className={`${inputCls} h-auto py-2.5`} value={f.description} onChange={set("description")} /></Field>
        <Err msg={error} />
        <PillButton variant="primary" className="w-full" disabled={busy || isGroupLeader} onClick={() => void save()}>
          <Icon name="check" className="h-4 w-4" /> {busy ? "Submitting…" : "Submit for approval"}
        </PillButton>
        <p className="text-center text-xs text-slate-400">Pending approval — approved runs appear on the public events list.</p>
      </div>
      )}
    </Sheet>
  );
}

/**
 * Solo-run scheduling — the runner's own private runs (owner direction
 * 2026-08-17: "schedule your own runs that are by yourself"). Distinct from
 * community submissions: no moderation, no public listing, and `visibility`
 * stays "private" (server-enforced). The server requires an explicit consent
 * flag (PERSONAL_RUN_CONSENT_VERSION) on every create/update.
 */

/**
 * Convert a `datetime-local` wall-clock value ("2026-08-20T18:00") into the
 * app's UTC-encoded wall-clock label ("2026-08-20T18:00:00Z") — the same
 * convention ical.ts documents for RSVP occurrences and solo runs. This makes
 * My Runs display the exact time the runner picked and the ICS export emit a
 * floating local time (see ical.ts TIMESTAMP / TIMEZONE ASSUMPTION). Returns
 * "" for anything the server's startsAt regex would reject (the input only
 * ever produces minute precision, so seconds + Z complete the label).
 */
export function toSoloRunStartsAt(local: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return "";
  return `${local}:00Z`;
}

export interface SoloRunFormFields {
  title: string;
  startsAt: string;
  locationLabel: string;
  distanceLabel: string;
}

/**
 * Build the exact createPersonalRun payload. Consent is ALWAYS true here — the
 * checkbox gates submission client-side and the server independently re-checks
 * the flag and the consent version before persisting anything.
 */
export function buildSoloRunInput(cityId: string, f: SoloRunFormFields): Parameters<typeof api.createPersonalRun>[0] {
  return {
    cityId,
    title: f.title.trim(),
    startsAt: toSoloRunStartsAt(f.startsAt),
    locationLabel: f.locationLabel.trim() || null,
    distanceLabel: f.distanceLabel.trim() || null,
    notes: null,
    consent: true,
  };
}

/**
 * "Schedule my own run" bottom sheet — used from the EventsPage host section
 * and the MyRunsHeader. Mirrors the PersonalRunsPage form fields (title, start
 * time, optional location/distance) plus the mandatory privacy consent
 * checkbox. On success it toasts, closes, and lets the parent decide what
 * happens next (navigate to My Runs, or refresh the list in place).
 */
export function SoloRunSheet({ open, onClose, cityId, onScheduled }: { open: boolean; onClose: () => void; cityId: string; onScheduled?: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [f, setF] = useState<SoloRunFormFields>({ title: "", startsAt: "", locationLabel: "", distanceLabel: "" });
  useEffect(() => {
    if (open) {
      setF({ title: "", startsAt: "", locationLabel: "", distanceLabel: "" });
      setConsent(false);
      setError(null);
      setBusy(false);
    }
  }, [open]);
  const set = (k: keyof SoloRunFormFields) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    if (busy) return;
    if (!consent) {
      setError("Please confirm the privacy checkbox before scheduling.");
      return;
    }
    setBusy(true);
    setError(null);
    const r = await api.createPersonalRun(buildSoloRunInput(cityId, f));
    setBusy(false);
    if (r.ok) {
      toast("Solo run scheduled.", "success");
      onClose();
      onScheduled?.();
      return;
    }
    setError(r.error.message ?? "Please check the title, date, and consent.");
  };
  return (
    <Sheet open={open} onClose={onClose} title="Schedule my own run" subtitle="Private — only you can see it. It lands on My Runs and your calendar export.">
      <div className="space-y-4">
        <Field label="Run title"><input className={inputCls} placeholder="e.g. Easy morning run" maxLength={120} value={f.title} onChange={set("title")} /></Field>
        <Field label="Start time"><input type="datetime-local" className={inputCls} value={f.startsAt} onChange={set("startsAt")} /></Field>
        <Field label="Location (optional)"><input className={inputCls} placeholder="e.g. Stephens Lake" maxLength={160} value={f.locationLabel} onChange={set("locationLabel")} /></Field>
        <Field label="Distance (optional)"><input className={inputCls} placeholder="e.g. 5 miles" maxLength={80} value={f.distanceLabel} onChange={set("distanceLabel")} /></Field>
        <label className="flex items-start gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 h-4 w-4 accent-emerald-700" />
          <span>I understand this run is private to my account.</span>
        </label>
        <Err msg={error} />
        <PillButton variant="primary" className="w-full" disabled={busy || !f.title.trim() || !f.startsAt || !consent} onClick={() => void save()}>
          <Icon name="check" className="h-4 w-4" /> {busy ? "Saving…" : "Schedule solo run"}
        </PillButton>
        <p className="text-center text-xs text-slate-400">No moderation or public listing — this run is only in My Runs and your calendar export.</p>
      </div>
    </Sheet>
  );
}

// ------------------------------------------------------------ Log a run (B2)

export type ActivityDistanceUnit = "km" | "mi";
export interface LogRunFormFields {
  /** Numeric distance (value only). */
  distance: string;
  unit: ActivityDistanceUnit;
  /** Hours as a string from the numeric input ("" or "0" allowed). */
  hours: string;
  /** Minutes 0–59. */
  minutes: string;
  /** Optional ISO datetime-local string ("" = the server uses now). */
  startedAt: string;
  /** Optional caption, server-truncated to 280 chars. */
  caption: string;
}
export const EMPTY_LOG_RUN: LogRunFormFields = { distance: "", unit: "km", hours: "", minutes: "", startedAt: "", caption: "" };
const MILES_PER_METER = 1609.344;

/**
 * Build the exact postManualActivity payload from the form, or null when the
 * input is invalid (missing/zero distance, non-numeric, bad time). The server
 * re-validates everything regardless — this just catches obvious client errors
 * so we never send a pointless request.
 */
export function buildManualActivityInput(f: LogRunFormFields): api.ManualActivityInput | null {
  const distance = Number(f.distance);
  if (!Number.isFinite(distance) || distance <= 0) return null;
  const hours = Number(f.hours);
  const minutes = Number(f.minutes);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || hours < 0 || minutes < 0 || minutes > 59) return null;
  const durationSeconds = Math.round((hours || 0) * 3600 + (minutes || 0) * 60);
  if (durationSeconds <= 0) return null;
  return {
    distanceMeters: Math.round(f.unit === "mi" ? distance * MILES_PER_METER : distance * 1000),
    durationSeconds,
    startedAt: f.startedAt ? `${f.startedAt}:00Z` : undefined,
    caption: f.caption.trim() || undefined,
  };
}

/**
 * "Log a run" bottom sheet — a VERIFIED runner records a completed run by hand
 * (distance, duration, optional date, optional caption). Manual posting only;
 * provider OAuth import is out of scope until the owner supplies creds. Entry
 * is gated to verified runners by the callers (unverified users get the
 * VerifiedGateSheet, never this form). Submit -> client postManualActivity.
 */
export function LogRunSheet({ open, onClose, onLogged }: { open: boolean; onClose: () => void; onLogged?: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState<LogRunFormFields>(EMPTY_LOG_RUN);
  useEffect(() => {
    if (open) {
      setF(EMPTY_LOG_RUN);
      setError(null);
      setBusy(false);
    }
  }, [open]);
  const set = (k: keyof LogRunFormFields) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setF({ ...f, [k]: e.target.value });
  const save = async () => {
    if (busy) return;
    const input = buildManualActivityInput(f);
    if (!input) {
      setError("Enter a distance and a duration (e.g. 5 km in 30 min) to log a run.");
      return;
    }
    setBusy(true);
    setError(null);
    const r = await api.postManualActivity(input);
    setBusy(false);
    if (r.ok) {
      toast("Run logged to your profile.", "success");
      onClose();
      onLogged?.();
      return;
    }
    setError(r.error.message ?? "Couldn't log this run. Try again.");
  };
  return (
    <Sheet open={open} onClose={onClose} title="Log a run" subtitle="Record a run you finished — it shows as an activity card on your public profile and in Connections.">
      <div className="space-y-4">
        <Field label="Distance">
          <div className="flex gap-2">
            <input className={inputCls} inputMode="decimal" placeholder="e.g. 5" value={f.distance} onChange={set("distance")} />
            <div className="flex shrink-0 rounded-xl bg-slate-100 p-1" role="group" aria-label="Distance unit">
              {(["km", "mi"] as const).map((u) => (
                <button
                  key={u}
                  type="button"
                  aria-pressed={f.unit === u}
                  onClick={() => setF({ ...f, unit: u })}
                  className={`min-h-11 rounded-lg px-3 text-xs font-bold ${f.unit === u ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}
                >
                  {u}
                </button>
              ))}
            </div>
          </div>
        </Field>
        <Field label="Duration">
          <div className="flex gap-2">
            <input className={inputCls} inputMode="numeric" placeholder="Hours" aria-label="Hours" value={f.hours} onChange={set("hours")} />
            <input className={inputCls} inputMode="numeric" placeholder="Minutes" aria-label="Minutes" value={f.minutes} onChange={set("minutes")} />
          </div>
        </Field>
        <Field label="Date (optional)">
          <input type="datetime-local" className={inputCls} value={f.startedAt} onChange={set("startedAt")} />
          <span className="mt-1 block text-xs text-slate-400">Defaults to now when left blank.</span>
        </Field>
        <Field label="Caption (optional)">
          <textarea className={`${inputCls} h-20 resize-none py-2.5`} maxLength={280} placeholder="How'd it go?" value={f.caption} onChange={set("caption")} />
          <span className="mt-1 block text-right text-xs text-slate-400">{f.caption.length}/280</span>
        </Field>
        <Err msg={error} />
        <PillButton variant="primary" className="w-full" disabled={busy} onClick={() => void save()}>
          <Icon name="check" className="h-4 w-4" /> {busy ? "Saving…" : "Log run"}
        </PillButton>
        <p className="text-center text-xs text-slate-400">
          Logged manually — posted as your own activity on your public profile and visible to connections (respecting your past-activity privacy).
        </p>
      </div>
    </Sheet>
  );
}
