/**
 * "Share feedback" bottom sheet for a runner profile — the ONLY way a runner's
 * community standing advances past "new", surfaced now as UI. The page gates
 * the affordance to verified signed-in viewers; the server gates everything.
 *
 * Three flows, each keyed to a SHARED event (both runners RSVP'd to or hosted
 * it — see ratingEligibility):
 *  - Positive rating: pick up to 3 trust tags (ALLOWED_TRUST_TAGS, optional)
 *    → POST /api/ratings.
 *  - Negative rating: 5–500 char reason, admins review it privately
 *    → POST /api/ratings (auto under-review at threshold server-side).
 *  - Concern: 5–500 char reason, admins only, never public → POST /api/concerns.
 *
 * Honest states: the event list loads from /api/runners/:id/shared-events and
 * preselects the single shared run; zero shared runs renders a real empty
 * state with submit disabled; server errors (401/403 gates, 409 already-rated,
 * eligibility) surface verbatim. On success the sheet shows a brief
 * confirmation and asks the parent to refresh the profile data.
 *
 * Presentational children are exported for SSR tests (react-dom/server — no
 * jsdom; see runlocal-ui-tests-no-jsdom).
 */
import { useEffect, useState } from "react";
import {
  getRunnerSharedEvents,
  submitConcern,
  submitRating,
  type SharedEventView,
} from "../lib/api";
import { ALLOWED_TRUST_TAGS, type TrustTag } from "../server/types";
import { Icon, PillButton, Sheet } from "./ui";

/** Friendly labels for the server-authoritative trust tags. */
export const TRUST_TAG_LABELS: Record<TrustTag, string> = {
  reliable: "Reliable",
  welcoming: "Welcoming",
  "safety-minded": "Safety-minded",
  knowledgeable: "Knowledgeable",
  "well-organized": "Well-organized",
};

export const FEEDBACK_REASON_MIN = 5;
export const FEEDBACK_REASON_MAX = 500;
export const MAX_TAGS = 3;

type FeedbackMode = "choose" | "positive" | "negative" | "concern" | "done";

/** Event selector: loading / honest empty / single preselect / dropdown. */
export function RunnerFeedbackEvents({
  events,
  runnerName,
  selectedEventId,
  onSelect,
  error,
}: {
  events: SharedEventView[] | null;
  runnerName: string;
  selectedEventId: string | null;
  onSelect: (eventId: string) => void;
  error: string | null;
}) {
  if (error) {
    return (
      <p role="alert" className="flex items-start gap-2 rounded-xl bg-red-50 p-3 text-[13px] leading-relaxed text-red-800">
        <Icon name="alertTriangle" className="mt-0.5 h-4 w-4 shrink-0" />
        <span>{error}</span>
      </p>
    );
  }
  if (events === null) {
    return (
      <p className="flex items-center gap-2 rounded-xl bg-slate-50 p-3 text-[13px] text-slate-500">
        <Icon name="clock" className="h-4 w-4" /> Checking shared runs…
      </p>
    );
  }
  if (events.length === 0) {
    return (
      <p className="rounded-xl bg-slate-50 p-3 text-[13px] leading-relaxed text-slate-500">
        You and {runnerName} haven't run the same Run Local event yet — feedback unlocks after a shared run.
      </p>
    );
  }
  if (events.length === 1) {
    const e = events[0];
    return (
      <div className="rounded-xl bg-slate-50 px-3 py-2.5 text-[13px]">
        <span className="font-semibold text-slate-800">{e.title}</span>
        <span className="text-slate-400"> · {e.date}</span>
      </div>
    );
  }
  return (
    <label className="block">
      <span className="block text-[13px] font-semibold text-slate-800">
        Shared run <span className="font-normal text-slate-400">(required)</span>
      </span>
      <select
        value={selectedEventId ?? ""}
        onChange={(ev) => onSelect(ev.target.value)}
        className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-[14px] text-slate-900 focus:border-[#FF5741] focus:outline-none"
      >
        <option value="" disabled>
          Choose a run…
        </option>
        {events.map((e) => (
          <option key={e.eventId} value={e.eventId}>
            {e.title} · {e.date}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Positive-rating tag checkboxes (server-authoritative ALLOWED_TRUST_TAGS). */
export function RunnerFeedbackTags({
  selected,
  onToggle,
  disabled = false,
}: {
  selected: TrustTag[];
  onToggle: (tag: TrustTag) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset>
      <legend className="block text-[13px] font-semibold text-slate-800">
        What stood out? <span className="font-normal text-slate-400">(optional, up to {MAX_TAGS})</span>
      </legend>
      <div className="mt-1.5 flex flex-wrap gap-2">
        {ALLOWED_TRUST_TAGS.map((tag) => {
          const active = selected.includes(tag);
          const atLimit = selected.length >= MAX_TAGS && !active;
          return (
            <button
              key={tag}
              type="button"
              aria-pressed={active}
              disabled={disabled || atLimit}
              onClick={() => onToggle(tag)}
              className={`min-h-10 rounded-full px-3.5 text-[13px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                active
                  ? "bg-[#14171C] text-[#FF5741] ring-1 ring-[#14171C]"
                  : "bg-white text-slate-600 ring-1 ring-slate-200 active:bg-slate-50"
              }`}
            >
              {TRUST_TAG_LABELS[tag]}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

/** Shared reason textarea with 5–500 counter and the honest privacy hint. */
export function RunnerFeedbackReason({
  value,
  onChange,
  label,
  hint,
  busy = false,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  hint: string;
  busy?: boolean;
}) {
  const length = value.length;
  const valid = length >= FEEDBACK_REASON_MIN && length <= FEEDBACK_REASON_MAX;
  return (
    <div className="space-y-1.5">
      <label htmlFor="runner-feedback-reason" className="block text-[13px] font-semibold text-slate-800">
        {label} <span className="font-normal text-slate-400">(required)</span>
      </label>
      <textarea
        id="runner-feedback-reason"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={FEEDBACK_REASON_MAX}
        disabled={busy}
        placeholder="Be specific and factual"
        rows={4}
        className="w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-[14px] text-slate-900 placeholder:text-slate-400 focus:border-[#FF5741] focus:outline-none disabled:bg-slate-50 disabled:text-slate-400"
      />
      <div className="flex items-start justify-between gap-3 text-[11px]">
        <span className="text-slate-400">{valid ? hint : `${FEEDBACK_REASON_MIN}–${FEEDBACK_REASON_MAX} characters`}</span>
        <span className={length >= FEEDBACK_REASON_MAX ? "shrink-0 font-semibold text-amber-700" : "shrink-0 text-slate-400"}>
          {length} / {FEEDBACK_REASON_MAX}
        </span>
      </div>
    </div>
  );
}

/** The full sheet. Owns flow state; server errors render verbatim. */
export function RunnerFeedbackSheet({
  open,
  onClose,
  runnerId,
  runnerName,
  onSubmitted,
}: {
  open: boolean;
  onClose: () => void;
  runnerId: string;
  runnerName: string;
  /** Called after a successful submit so the parent can refresh profile data. */
  onSubmitted?: () => void;
}) {
  const [mode, setMode] = useState<FeedbackMode>("choose");
  const [events, setEvents] = useState<SharedEventView[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [tags, setTags] = useState<TrustTag[]>([]);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let live = true;
    setMode("choose");
    setEvents(null);
    setLoadError(null);
    setSelectedEventId(null);
    setTags([]);
    setReason("");
    setError(null);
    void getRunnerSharedEvents(runnerId).then((r) => {
      if (!live) return;
      if (r.ok) {
        setEvents(r.data.events);
        if (r.data.events.length === 1) setSelectedEventId(r.data.events[0].eventId);
      } else if (r.error.status === 401) {
        setLoadError("Sign in to share feedback with a runner you've run with.");
      } else if (r.error.status === 403) {
        setLoadError("Only verified runners can share feedback.");
      } else {
        setLoadError(r.error.message ?? "Could not load shared runs.");
      }
    });
    return () => {
      live = false;
    };
  }, [open, runnerId]);

  const selectedEvent = events?.find((e) => e.eventId === selectedEventId) ?? null;
  const reasonValid = reason.trim().length >= FEEDBACK_REASON_MIN && reason.trim().length <= FEEDBACK_REASON_MAX;
  const canChoose = events !== null && events.length > 0 && selectedEventId !== null;

  const submit = async () => {
    if (!canChoose || !selectedEventId) return;
    setBusy(true);
    setError(null);
    const base = { revieweeId: runnerId, eventId: selectedEventId };
    const r =
      mode === "positive"
        ? await submitRating({ ...base, positive: true, tags })
        : mode === "negative"
          ? await submitRating({ ...base, positive: false, reason: reason.trim() })
          : await submitConcern({ subjectId: runnerId, eventId: selectedEventId, reason: reason.trim() });
    setBusy(false);
    if (r.ok) {
      setMode("done");
      onSubmitted?.();
    } else if (r.error.status === 401) {
      setError("Your session expired — sign in again and retry.");
    } else if (r.error.status === 403) {
      setError(r.error.message ?? "Only verified runners who shared this run can submit feedback.");
    } else if (r.error.status === 409 && r.error.code === "already_rated") {
      setError(`You already rated ${runnerName} for this event.`);
    } else {
      setError(r.error.message ?? "Feedback wasn't submitted. Try again.");
    }
  };

  const eventSummary = selectedEvent ? (
    <p className="rounded-xl bg-slate-50 px-3 py-2 text-[13px] text-slate-600">
      For: <span className="font-semibold text-slate-800">{selectedEvent.title}</span>
      <span className="text-slate-400"> · {selectedEvent.date}</span>
    </p>
  ) : null;

  const alert = error ? (
    <p role="alert" className="flex items-start gap-2 rounded-xl bg-red-50 p-3 text-[13px] leading-relaxed text-red-800">
      <Icon name="alertTriangle" className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{error}</span>
    </p>
  ) : null;

  const backButton = (
    <PillButton variant="ghost" className="flex-1" onClick={() => setMode("choose")} disabled={busy}>
      Back
    </PillButton>
  );

  if (mode === "done") {
    return (
      <Sheet open={open} onClose={onClose} title="Feedback sent">
        <div className="py-6 text-center">
          <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-emerald-100">
            <Icon name="check" className="h-7 w-7 text-emerald-700" />
          </span>
          <p className="mt-4 text-[15px] font-bold text-slate-900">Thanks for your feedback.</p>
          <p className="mt-1 text-[13px] leading-relaxed text-slate-500">
            Run Local admins review everything privately — nothing you wrote appears on {runnerName}'s public profile.
          </p>
          <PillButton variant="secondary" className="mt-5 w-full" onClick={onClose}>
            Done
          </PillButton>
        </div>
      </Sheet>
    );
  }

  if (mode === "positive") {
    return (
      <Sheet open={open} onClose={onClose} title="Positive feedback" subtitle={`What stood out about running with ${runnerName}?`}>
        <div className="space-y-4">
          {eventSummary}
          <RunnerFeedbackTags
            selected={tags}
            disabled={busy}
            onToggle={(tag) =>
              setTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : prev.length >= MAX_TAGS ? prev : [...prev, tag]))
            }
          />
          <p className="text-[12px] leading-relaxed text-slate-400">
            Positive feedback builds {runnerName}'s community standing. Tags are optional and stay qualitative.
          </p>
          {alert}
          <div className="flex gap-3">
            {backButton}
            <button
              type="button"
              onClick={submit}
              disabled={busy || !selectedEventId}
              className="rl-control inline-flex desktop-compact-control min-h-11 flex-1 items-center justify-center gap-2 px-5 text-sm font-semibold transition-colors bg-[#14171C] text-white active:opacity-90 disabled:bg-slate-200 disabled:text-slate-400"
            >
              {busy ? "Working…" : "Send positive feedback"}
            </button>
          </div>
        </div>
      </Sheet>
    );
  }

  if (mode === "negative") {
    return (
      <Sheet
        open={open}
        onClose={onClose}
        title="Negative feedback"
        subtitle={`Admins review this privately — it never appears on ${runnerName}'s public profile.`}
      >
        <div className="space-y-4">
          {eventSummary}
          <RunnerFeedbackReason
            value={reason}
            onChange={setReason}
            label="What happened?"
            hint="Admins review it privately — your name is never shown to the runner."
            busy={busy}
          />
          {alert}
          <div className="flex gap-3">
            {backButton}
            <button
              type="button"
              onClick={submit}
              disabled={busy || !selectedEventId || !reasonValid}
              className="rl-control inline-flex desktop-compact-control min-h-11 flex-1 items-center justify-center gap-2 px-5 text-sm font-semibold transition-colors bg-red-600 text-white active:bg-red-700 disabled:bg-slate-200 disabled:text-slate-400"
            >
              {busy ? "Working…" : "Send negative feedback"}
            </button>
          </div>
        </div>
      </Sheet>
    );
  }

  if (mode === "concern") {
    return (
      <Sheet
        open={open}
        onClose={onClose}
        title="Raise a concern"
        subtitle={`For safety and conduct issues — goes to Run Local admins only, never public.`}
      >
        <div className="space-y-4">
          {eventSummary}
          <RunnerFeedbackReason
            value={reason}
            onChange={setReason}
            label="Describe the concern"
            hint="Goes to admins only — never public, and never shown to the runner."
            busy={busy}
          />
          {alert}
          <div className="flex gap-3">
            {backButton}
            <button
              type="button"
              onClick={submit}
              disabled={busy || !selectedEventId || !reasonValid}
              className="rl-control inline-flex desktop-compact-control min-h-11 flex-1 items-center justify-center gap-2 px-5 text-sm font-semibold transition-colors bg-[#14171C] text-white active:opacity-90 disabled:bg-slate-200 disabled:text-slate-400"
            >
              {busy ? "Working…" : "Submit concern"}
            </button>
          </div>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Share feedback"
      subtitle={`Verified runners only — you must have run with ${runnerName}`}
    >
      <div className="space-y-4">
        <RunnerFeedbackEvents
          events={events}
          runnerName={runnerName}
          selectedEventId={selectedEventId}
          onSelect={setSelectedEventId}
          error={loadError}
        />
        <div className="grid gap-2">
          <button
            type="button"
            onClick={() => setMode("positive")}
            disabled={!canChoose}
            className="flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 text-[14px] font-semibold text-slate-800 active:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
          >
            <Icon name="spark" className="h-4 w-4" /> Positive feedback
            <span className="ml-auto text-[11px] font-normal text-slate-400">tags, optional</span>
          </button>
          <button
            type="button"
            onClick={() => setMode("negative")}
            disabled={!canChoose}
            className="flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 text-[14px] font-semibold text-slate-800 active:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
          >
            <Icon name="flag" className="h-4 w-4" /> Negative feedback
            <span className="ml-auto text-[11px] font-normal text-slate-400">admins review privately</span>
          </button>
          <button
            type="button"
            onClick={() => setMode("concern")}
            disabled={!canChoose}
            className="flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 text-[14px] font-semibold text-slate-800 active:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
          >
            <Icon name="shield" className="h-4 w-4" /> Raise a concern
            <span className="ml-auto text-[11px] font-normal text-slate-400">admins only, never public</span>
          </button>
        </div>
        <p className="text-[12px] leading-relaxed text-slate-400">
          Feedback is private: reviewers are never shown publicly, and negative ratings or concerns go to Run Local
          admins only.
        </p>
      </div>
    </Sheet>
  );
}
