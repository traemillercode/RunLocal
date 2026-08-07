/**
 * Community submission forms (race / group / independent event). Each form
 * submits to the server-side pending queue — the server is authoritative for
 * every permission and validation. The UI only surfaces server verdicts.
 */
import { useState } from "react";
import * as api from "../lib/api";
import { Icon, PillButton, Sheet } from "./ui";
import { useToast } from "../lib/toast";
import { useAccount } from "../state/account";

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
  const toast = useToast();
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
      toast("Submitted! It's pending approval and will appear publicly once approved.", "success");
      return true;
    }
    setError(r.error.message ?? "Couldn't submit. Check the highlighted fields.");
    return false;
  };
  return { busy, error, setError, submit };
}

/** Race submission: verified runners / race directors. */
export function RaceSubmissionSheet({ open, onClose, onSubmitted, cityId }: { open: boolean; onClose: () => void; onSubmitted?: () => void; cityId: string }) {
  const { busy, error, submit } = useSubmit();
  const [f, setF] = useState({ name: "", distances: "", date: "", location: "", registrationUrl: "", description: "" });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    const ok = await submit(() => api.submitRace({ ...f, cityId }));
    if (ok) {
      setF({ name: "", distances: "", date: "", location: "", registrationUrl: "", description: "" });
      onClose();
      onSubmitted?.();
    }
  };
  return (
    <Sheet open={open} onClose={onClose} title="Submit a race" subtitle="Verified runners & race directors — pending approval before it's public">
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
    </Sheet>
  );
}

/** Group submission: verified runners. RRCA option is a request, not a claim. */
export function GroupSubmissionSheet({ open, onClose, onSubmitted, cityId }: { open: boolean; onClose: () => void; onSubmitted?: () => void; cityId: string }) {
  const { busy, error, setError, submit } = useSubmit();
  const [uploading, setUploading] = useState(false);
  const [f, setF] = useState({ name: "", description: "", groupType: "community", groupmeUrl: "", facebookUrl: "", instagramUrl: "", websiteUrl: "", coverPhoto: "", logoPhoto: "", membershipMode: "request" });
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
          groupmeUrl: f.groupmeUrl || undefined, facebookUrl: f.facebookUrl || undefined,
          instagramUrl: f.instagramUrl || undefined, websiteUrl: f.websiteUrl || undefined,
          coverPhoto: cover.data.photoRef, logoPhoto: logo.data.photoRef, membershipMode: f.membershipMode as "open" | "request",
        }),
      );
      if (ok) {
        setF({ name: "", description: "", groupType: "community", groupmeUrl: "", facebookUrl: "", instagramUrl: "", websiteUrl: "", coverPhoto: "", logoPhoto: "", membershipMode: "request" });
        onClose();
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
        <Field label="GroupMe link (optional)"><input className={inputCls} placeholder="https://groupme.com/…" inputMode="url" value={f.groupmeUrl} onChange={set("groupmeUrl")} /></Field>
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
    </Sheet>
  );
}

/** Independent event submission: verified runners WITHOUT the Group Leader role. */
export function IndependentEventSheet({ open, onClose, onSubmitted, cityId }: { open: boolean; onClose: () => void; onSubmitted?: () => void; cityId: string }) {
  const { me } = useAccount();
  const { busy, error, submit } = useSubmit();
  const [f, setF] = useState({ type: "recurring", title: "", date: "", dayOfWeek: "0", time: "6:00 PM", location: "", distanceLabel: "", invite: "Open to all", externalUrl: "", description: "" });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const isGroupLeader = me?.status === "signed_in" && me.account.role === "group_leader";
  const save = async () => {
    const ok = await submit(() =>
      api.submitEvent({
        cityId, type: f.type as "one_time" | "recurring", title: f.title,
        date: f.type === "one_time" ? f.date || null : null,
        dayOfWeek: f.type === "recurring" ? Number(f.dayOfWeek) : null,
        time: f.time, location: f.location, distanceLabel: f.distanceLabel, invite: f.invite,
        externalUrl: f.externalUrl || undefined, description: f.description,
      }),
    );
    if (ok) {
      setF({ type: "recurring", title: "", date: "", dayOfWeek: "0", time: "6:00 PM", location: "", distanceLabel: "", invite: "Open to all", externalUrl: "", description: "" });
      onClose();
      onSubmitted?.();
    }
  };
  return (
    <Sheet open={open} onClose={onClose} title="Host an independent run" subtitle="Not tied to a group — host shows as Independent Runner">
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
        <Field label="Distance / pace"><input className={inputCls} placeholder="e.g. 3–5 mi, no-drop pace" value={f.distanceLabel} onChange={set("distanceLabel")} /></Field>
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
    </Sheet>
  );
}
