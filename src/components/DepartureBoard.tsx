import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import type { ReactNode } from "react";
import { Icon } from "./ui";
import { rsvpEvent } from "../lib/api";

/* ═══════════════════════════════════════════════════════════════════════════
   KIMBIO — DEPARTURE BOARD
   Discovery surface for local group runs + weekly track events.

   Brand rules enforced here:
     ink #14171C · coral #FF5741 · never white type on coral
   ═══════════════════════════════════════════════════════════════════════════ */

export type EventType = "track" | "group" | "long" | "trail";

export interface Person {
  id: string;
  initials: string;
  tone: number;
}

export interface EventHost {
  name: string;
  initials: string;
}

/** The view model this component owns. Adapt DB rows into this shape at the
 *  query boundary (mapRunEvent) so schema changes never reach the JSX. */
export interface RunEvent {
  id: string;
  name: string;
  type: EventType;
  /** Real Date. The 90-minute decay math and Intl formatting both need it. */
  startsAt: Date;
  venue: string;
  area: string;
  /** Already-formatted display strings, e.g. "7:45". "All" renders as "All paces". */
  paceLow: string;
  paceHigh: string;
  /** Session shorthand: "6 mi", "12 × 400m", "8 × hill". */
  detail: string;
  host: EventHost;
  attendees: Person[];
  goingCount: number;
  /** SVG path string in a "0 0 60 200" viewBox, or null when no route is attached. */
  routePath: string | null;
  /** 0 = free. Anything above routes through Stripe Checkout. */
  priceCents: number;
}

const INK = "#14171C";
const INK_SOFT = "#1E2229";
const CORAL = "#FF5741";
const LINE = "#E4E4DF";

const SPRING = "cubic-bezier(0.34, 1.4, 0.64, 1)";
const MECH = "cubic-bezier(0.2, 0, 0.4, 1)";

/* ─────────────────────────────────────────────────────────────────────────────
   BACKEND SEAMS

   Self-contained on purpose — no external imports, so this renders anywhere.
   Each stub resolves after a short delay to exercise the optimistic-update and
   rollback paths. Swap the bodies for your real clients when you paste this in.

   createRsvp   → supabase client, table `event_rsvps`, upsert
                  { event_id, user_id, status: "going" } on conflict
                  (event_id, user_id); select back events.going_count.
   deleteRsvp   → same table, update status "withdrawn" + withdrawn_at,
                  matched on (event_id, user_id). Soft delete keeps the host's
                  attendance history intact.
   startCheckout→ POST to your Railway API /checkout/session with { eventId },
                  then window.location.assign(url). Never mint the Stripe
                  session client-side.

   Resend confirmation email fires from the edge function on rsvp insert, never
   from the client, so an unauthenticated caller can't drive sends.
   ───────────────────────────────────────────────────────────────────────────── */

/** Splits a canonical occurrence id ("event:<eventId>:<YYYY-MM-DD>") into its parts - the adapter sets RunEvent.id to this form so a single string carries both what the RSVP endpoint needs. */
function parseOccurrenceId(occurrenceId: string): { eventId: string; runDate: string } {
  const match = /^event:(.+):(\d{4}-\d{2}-\d{2})$/.exec(occurrenceId);
  if (!match) return { eventId: occurrenceId, runDate: "" };
  return { eventId: match[1], runDate: match[2] };
}

/** Upsert the current user's RSVP for this occurrence. */
async function createRsvp(occurrenceId: string): Promise<void> {
  const { eventId, runDate } = parseOccurrenceId(occurrenceId);
  const r = await rsvpEvent(eventId, true, runDate);
  if (!r.ok) throw new Error(r.error.message ?? "Couldn't RSVP.");
}

/** Withdraw an RSVP for this occurrence. */
async function deleteRsvp(occurrenceId: string): Promise<void> {
  const { eventId, runDate } = parseOccurrenceId(occurrenceId);
  const r = await rsvpEvent(eventId, false, runDate);
  if (!r.ok) throw new Error(r.error.message ?? "Couldn't drop your spot.");
}

/**
 * Paid sessions (coached track blocks) would route through Stripe Checkout -
 * no event in the current data model carries a real price yet (priceCents
 * always maps to 0 from the adapter), so this stays an honest not-yet-built
 * path rather than a fake success, in case a priced event is ever added
 * before real checkout exists.
 */
async function startCheckout(_occurrenceId: string): Promise<void> {
  throw new Error("Paid sessions aren't set up yet - check back soon.");
}

/* ─────────────────────────────────────────────────────────────────────────────
   MOCK DATA — Columbia, MO
   ───────────────────────────────────────────────────────────────────────────── */

const FILTERS: { id: EventType | "all"; label: string }[] = [
  { id: "all", label: "All runs" },
  { id: "track", label: "Track" },
  { id: "group", label: "Group" },
  { id: "long", label: "Long" },
  { id: "trail", label: "Trail" },
];

const TYPE_LABEL: Record<EventType, string> = { track: "Track", group: "Group run", long: "Long run", trail: "Trail" };
const TONES: string[] = ["#14171C", "#3C4450", "#8A5A4E", "#5A6B57"];

/* ─────────────────────────────────────────────────────────────────────────────
   TIME HELPERS
   ───────────────────────────────────────────────────────────────────────────── */

const timeFmt = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" });
const dowFmt = new Intl.DateTimeFormat("en-US", { weekday: "short" });
const monFmt = new Intl.DateTimeFormat("en-US", { month: "short" });

const dayKey = (d: Date): string => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

function splitTime(date: Date): { clock: string; meridiem: string } {
  const [clock, meridiem] = timeFmt.format(date).split(" ");
  return { clock, meridiem };
}

function bandLabel(date: Date, now: Date): string {
  const diff =
    Math.round(
      (new Date(date).setHours(0, 0, 0, 0) - new Date(now).setHours(0, 0, 0, 0)) / 86_400_000
    );
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  return `${dowFmt.format(date)} ${date.getDate()} ${monFmt.format(date)}`;
}

const MS_MIN = 60_000;

const minutesUntil = (date: Date, now: Date): number =>
  Math.round((date.getTime() - now.getTime()) / MS_MIN);

/* ─────────────────────────────────────────────────────────────────────────────
   PRIMITIVES
   ───────────────────────────────────────────────────────────────────────────── */

interface KickerProps {
  children: ReactNode;
  /** For genuinely dynamic or non-brand colors only - a fixed brand color (ink/coral) should go through className instead (e.g. "text-[#FF5741]"). */
  color?: string;
  className?: string;
}

function Kicker({ children, color, className = "" }: KickerProps) {
  return (
    <span
      className={`font-bold uppercase tracking-widest ${className}`}
      style={{ fontSize: "11px", letterSpacing: "0.14em", color }}
    >
      {children}
    </span>
  );
}

interface MetricProps {
  label: string;
  value: string;
  inverted: boolean;
}

function Metric({ label, value, inverted }: MetricProps) {
  const muted = inverted ? "rgba(255,255,255,0.55)" : "#7A7A72";
  return (
    <div className="flex flex-col gap-0.5 pr-5">
      <Kicker color={muted}>{label}</Kicker>
      <span
        className="font-extrabold tabular-nums"
        style={{
          fontSize: "15px",
          letterSpacing: "-0.015em",
          color: inverted ? "#FFFFFF" : INK,
        }}
      >
        {value}
      </span>
    </div>
  );
}

interface AvatarStackProps {
  attendees: Person[];
  count: number;
  inverted: boolean;
  justJoined: boolean;
}

function AvatarStack({ attendees, count, inverted, justJoined }: AvatarStackProps) {
  const ringColor = inverted ? INK_SOFT : "#FFFFFF";
  const shown = attendees.slice(0, 4);
  return (
    <div className="flex items-center">
      <div className="flex items-center">
        {justJoined && (
          <span
            className="kb-anim relative flex h-7 w-7 items-center justify-center rounded-full bg-[#FF5741] font-bold text-[#14171C]"
            style={{
              fontSize: "10px",
              boxShadow: `0 0 0 2px ${ringColor}`,
              animation: `kbSpringIn 420ms ${SPRING} both`,
              zIndex: 5,
            }}
          >
            YOU
          </span>
        )}
        {shown.map((p, i) => (
          <span
            key={p.id}
            className="relative flex h-7 w-7 items-center justify-center rounded-full font-semibold text-white"
            style={{
              fontSize: "10px",
              background: TONES[p.tone],
              boxShadow: `0 0 0 2px ${ringColor}`,
              marginLeft: i === 0 && !justJoined ? 0 : -8,
              zIndex: 4 - i,
            }}
          >
            {p.initials}
          </span>
        ))}
      </div>
      <span
        className="ml-2 font-semibold tabular-nums"
        style={{ fontSize: "12px", color: inverted ? "rgba(255,255,255,0.6)" : "#7A7A72" }}
      >
        {count} going
      </span>
    </div>
  );
}

interface RouteSliverProps {
  path: string;
  inverted: boolean;
}

function RouteSliver({ path, inverted }: RouteSliverProps) {
  return (
    <div
      className="relative hidden shrink-0 overflow-hidden sm:block"
      style={{
        width: 96,
        background: inverted ? "rgba(255,255,255,0.05)" : "#12151A",
        borderLeft: `1px solid ${inverted ? "rgba(255,255,255,0.08)" : "transparent"}`,
      }}
      aria-hidden="true"
    >
      <svg viewBox="0 0 60 200" preserveAspectRatio="none" className="h-full w-full">
        <path
          d={path}
          fill="none"
          className="stroke-[#FF5741]"
          strokeWidth="3"
          strokeLinecap="round"
          opacity="0.9"
        />
      </svg>
      <span
        className="absolute bottom-2 left-2 font-bold uppercase"
        style={{ fontSize: "9px", letterSpacing: "0.16em", color: "rgba(255,255,255,0.45)" }}
      >
        Route
      </span>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   RSVP BUTTON — morphs rather than swapping labels.
   idle → going (fill coral, width contracts, label crossfades to check)
   going → confirming ("Drop out?") → idle. Two deliberate presses to leave.
   ───────────────────────────────────────────────────────────────────────────── */

interface RsvpButtonProps {
  event: RunEvent;
  going: boolean;
  pending: boolean;
  onJoin: () => void;
  onLeave: () => void;
  inverted: boolean;
}

function RsvpButton({ event, going, pending, onJoin, onLeave, inverted }: RsvpButtonProps) {
  const [confirming, setConfirming] = useState(false);
  const [pressed, setPressed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  useEffect(() => {
    if (!going) setConfirming(false);
  }, [going]);

  const handleClick = () => {
    if (!going) return onJoin();
    if (!confirming) {
      setConfirming(true);
      timer.current = setTimeout(() => setConfirming(false), 3000);
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    setConfirming(false);
    onLeave();
  };

  const width = going ? (confirming ? 116 : 104) : event.priceCents > 0 ? 118 : 96;

  const bg = going ? (confirming ? "transparent" : CORAL) : inverted ? "#FFFFFF" : INK;
  const fg = going ? (confirming ? CORAL : INK) : inverted ? INK : "#FFFFFF";
  const border = confirming ? `1.5px solid ${CORAL}` : "1.5px solid transparent";

  const label = !going
    ? event.priceCents > 0
      ? `Join · $${(event.priceCents / 100).toFixed(0)}`
      : "RSVP"
    : confirming
    ? "Drop out?"
    : "Going";

  return (
    <button
      type="button"
      onClick={handleClick}
      onPointerDown={() => setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onPointerLeave={() => setPressed(false)}
      disabled={pending}
      aria-pressed={going}
      aria-label={going ? `You are going to ${event.name}. Press twice to drop out.` : `RSVP to ${event.name}`}
      className="kb-anim kb-focus relative flex h-10 shrink-0 items-center justify-center gap-1.5 overflow-hidden rounded-full font-bold"
      style={{
        width,
        background: bg,
        color: fg,
        border,
        fontSize: "13px",
        letterSpacing: "-0.01em",
        opacity: pending ? 0.6 : 1,
        transform: `scale(${pressed ? 0.94 : 1})`,
        transition: `width 320ms ${SPRING}, background-color 200ms ${MECH}, color 200ms ${MECH}, transform 90ms ${MECH}, border-color 200ms ${MECH}`,
      }}
    >
      {going && !confirming && (
        <span className="inline-flex h-3.5 w-3.5" style={{ animation: `kbSpringIn 300ms ${SPRING} both` }}>
          <Icon name="check" className="h-3.5 w-3.5" />
        </span>
      )}
      <span className="whitespace-nowrap">{label}</span>
    </button>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   EVENT CARD
   88px time gutter + fluid body + optional 96px route sliver.
   ───────────────────────────────────────────────────────────────────────────── */

interface EventCardProps {
  event: RunEvent;
  now: Date;
  hero: boolean;
  going: boolean;
  pending: boolean;
  onJoin: () => void;
  onLeave: () => void;
}

function EventCard({ event, now, hero, going, pending, onJoin, onLeave }: EventCardProps) {
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);

  const mins = minutesUntil(event.startsAt, now);
  const imminent = mins > 0 && mins <= 90;
  const inverted = hero;

  const { clock, meridiem } = splitTime(event.startsAt);

  const gutterBg = going || hovered ? CORAL : inverted ? "#000000" : INK;
  const gutterFg = going || hovered ? INK : "#FFFFFF";
  const gutterMuted = going || hovered ? "rgba(20,23,28,0.65)" : "rgba(255,255,255,0.5)";

  const pace = event.paceLow === "All" ? "All paces" : `${event.paceLow}–${event.paceHigh}`;

  return (
    <article
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => {
        setHovered(false);
        setPressed(false);
      }}
      onPointerDown={() => setPressed(true)}
      onPointerUp={() => setPressed(false)}
      className="kb-anim group relative flex overflow-hidden rounded-2xl"
      style={{
        background: inverted ? INK : "#FFFFFF",
        border: `1px solid ${hovered ? "rgba(255,87,65,0.6)" : inverted ? "rgba(255,255,255,0.1)" : LINE}`,
        boxShadow: hovered
          ? "0 10px 24px -12px rgba(20,23,28,0.28)"
          : "0 1px 2px rgba(20,23,28,0.04)",
        transform: `translateY(${pressed ? 0 : hovered ? -2 : 0}px) scale(${pressed ? 0.985 : 1})`,
        transition: `transform ${pressed ? 90 : 260}ms ${pressed ? MECH : SPRING}, box-shadow 240ms ${MECH}, border-color 200ms ${MECH}`,
      }}
    >
      {/* ── Time gutter ─────────────────────────────────────────────── */}
      <div
        className="kb-anim relative flex shrink-0 flex-col items-center justify-center gap-1"
        style={{
          width: hero ? 104 : 88,
          background: gutterBg,
          color: gutterFg,
          transition: `background-color 220ms ${MECH}, color 220ms ${MECH}`,
          animation: imminent ? "kbPulse 2s ease-in-out infinite" : "none",
        }}
      >
        <span
          className="font-bold uppercase"
          style={{ fontSize: "10px", letterSpacing: "0.18em", color: gutterMuted }}
        >
          {dowFmt.format(event.startsAt)}
        </span>
        <span
          className="font-extrabold tabular-nums leading-none"
          style={{ fontSize: hero ? "34px" : "28px", letterSpacing: "-0.04em" }}
        >
          {event.startsAt.getDate()}
        </span>
        <span
          className="font-bold tabular-nums leading-none"
          style={{ fontSize: hero ? "15px" : "13px", letterSpacing: "-0.02em" }}
        >
          {clock}
          <span style={{ fontSize: "9px", marginLeft: 2, color: gutterMuted }}>{meridiem}</span>
        </span>
      </div>

      {/* ── Body ────────────────────────────────────────────────────── */}
      <div className={`flex min-w-0 flex-1 flex-col justify-between gap-4 ${hero ? "p-5 sm:p-6" : "p-4 sm:p-5"}`}>
        <div className="min-w-0">
          <div className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
            <Kicker className="text-[#FF5741]">{TYPE_LABEL[event.type]}</Kicker>
            {imminent && (
              <span
                className="rounded-full bg-[#FF5741] px-2 py-0.5 font-bold uppercase text-[#14171C]"
                style={{
                  fontSize: "10px",
                  letterSpacing: "0.12em",
                }}
              >
                Starts in {mins}m
              </span>
            )}
          </div>

          <h3
            className="truncate font-extrabold"
            style={{
              fontSize: hero ? "30px" : "20px",
              lineHeight: 1.05,
              letterSpacing: "-0.03em",
              color: inverted ? "#FFFFFF" : INK,
            }}
          >
            {event.name}
          </h3>

          <div
            className="mt-2 flex items-center gap-1.5"
            style={{ fontSize: "13px", color: inverted ? "rgba(255,255,255,0.6)" : "#7A7A72" }}
          >
            <Icon name="mapPin" className="h-3 w-3 shrink-0" />
            <span className="truncate">
              {event.venue} · {event.area}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex items-end">
            <Metric label="Pace" value={pace} inverted={inverted} />
            <div
              className="mr-5 h-8 w-px self-center"
              style={{ background: inverted ? "rgba(255,255,255,0.14)" : LINE }}
            />
            <Metric label="Session" value={event.detail} inverted={inverted} />
          </div>

          <div className="flex items-center gap-4">
            <AvatarStack
              attendees={event.attendees}
              count={event.goingCount + (going ? 1 : 0)}
              inverted={inverted}
              justJoined={going}
            />
            <RsvpButton
              event={event}
              going={going}
              pending={pending}
              onJoin={onJoin}
              onLeave={onLeave}
              inverted={inverted}
            />
          </div>
        </div>

        <div
          className="flex items-center gap-2 border-t pt-3"
          style={{ borderColor: inverted ? "rgba(255,255,255,0.1)" : LINE }}
        >
          <span
            className="flex h-5 w-5 items-center justify-center rounded font-bold text-white"
            style={{ fontSize: "9px", background: inverted ? "rgba(255,255,255,0.2)" : INK }}
          >
            {event.host.initials}
          </span>
          <span
            className="font-semibold"
            style={{ fontSize: "12px", color: inverted ? "rgba(255,255,255,0.6)" : "#7A7A72" }}
          >
            Hosted by {event.host.name}
          </span>
        </div>
      </div>

      {event.routePath && <RouteSliver path={event.routePath} inverted={inverted} />}
    </article>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   PAGE
   ───────────────────────────────────────────────────────────────────────────── */

export default function DepartureBoard({ events }: { events: RunEvent[] }) {
  const [now, setNow] = useState(() => new Date());
  const [filter, setFilter] = useState<EventType | "all">("all");
  const [rsvps, setRsvps] = useState<Set<string>>(() => new Set());
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Board order is always chronological. Sorting a copy keeps the caller's array intact.
  const EVENTS = useMemo(() => [...events].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime()), [events]);

  // Keeps the 90-minute decay state and "starts in Nm" copy honest.
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  const visible = useMemo(
    () => EVENTS.filter((e) => filter === "all" || e.type === filter),
    [EVENTS, filter]
  );

  const bands = useMemo(() => {
    const map = new Map<string, { label: string; events: RunEvent[] }>();
    for (const e of visible) {
      const k = dayKey(e.startsAt);
      if (!map.has(k)) map.set(k, { label: bandLabel(e.startsAt, now), events: [] });
      map.get(k)!.events.push(e);
    }
    return [...map.values()];
  }, [visible, now]);

  const heroId = visible[0]?.id;

  const join = useCallback(async (event: RunEvent) => {
    setPendingId(event.id);
    setRsvps((prev) => new Set(prev).add(event.id)); // optimistic
    try {
      if (event.priceCents > 0) await startCheckout(event.id);
      else await createRsvp(event.id);
    } catch {
      setRsvps((prev) => {
        const next = new Set(prev);
        next.delete(event.id);
        return next;
      });
      setToast("Couldn't save your RSVP. Check your connection and try again.");
    } finally {
      setPendingId(null);
    }
  }, []);

  const leave = useCallback(async (event: RunEvent) => {
    setPendingId(event.id);
    setRsvps((prev) => {
      const next = new Set(prev);
      next.delete(event.id);
      return next;
    });
    try {
      await deleteRsvp(event.id);
    } catch {
      setRsvps((prev) => new Set(prev).add(event.id));
      setToast("Couldn't drop your spot. Try again.");
    } finally {
      setPendingId(null);
    }
  }, []);

  const totalGoing = EVENTS.reduce((n: number, e: RunEvent) => n + e.goingCount, 0);

  return (
    <div className="min-h-screen w-full bg-[#F6F6F3] text-[#14171C]">
      <style>{`
        @keyframes kbPulse { 0%, 100% { opacity: 1 } 50% { opacity: 0.9 } }
        @keyframes kbSpringIn {
          0%   { transform: scale(0.4) translateY(6px); opacity: 0 }
          100% { transform: scale(1) translateY(0); opacity: 1 }
        }
        @keyframes kbRise {
          0%   { transform: translateY(10px); opacity: 0 }
          100% { transform: translateY(0); opacity: 1 }
        }
        .kb-focus:focus-visible {
          outline: 2px solid ${CORAL};
          outline-offset: 2px;
        }
        @media (prefers-reduced-motion: reduce) {
          .kb-anim, .kb-anim * {
            transition: none !important;
            animation: none !important;
          }
        }
      `}</style>

      {/* ── Masthead ──────────────────────────────────────────────────── */}
      <header
        className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-[#E4E4DF] px-4 sm:px-8"
        style={{ background: "rgba(246,246,243,0.88)", backdropFilter: "blur(12px)" }}
      >
        <div className="flex items-center gap-3">
          <span
            className="font-extrabold"
            style={{ fontSize: "19px", letterSpacing: "-0.05em" }}
          >
            kimbio
          </span>
          <span
            className="hidden items-center gap-1 rounded-full px-2.5 py-1 font-semibold sm:flex"
            style={{ fontSize: "11px", background: "#EBEBE6", color: "#5C5C55" }}
          >
            <Icon name="mapPin" className="h-2.5 w-2.5 shrink-0" />
            Columbia, MO
          </span>
        </div>
        <button
          type="button"
          className="kb-focus flex h-9 items-center gap-1.5 rounded-full bg-[#14171C] px-4 font-bold text-white"
          style={{ fontSize: "13px", letterSpacing: "-0.01em" }}
        >
          <Icon name="plus" className="h-3.5 w-3.5" />
          Host a run
        </button>
      </header>

      <main className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-8 sm:px-8 lg:flex-row lg:gap-10">
        {/* ── Rail ────────────────────────────────────────────────────── */}
        <div className="min-w-0 flex-1">
          <div className="mb-6">
            <Kicker className="text-[#FF5741]">This week in Columbia</Kicker>
            <h1
              className="mt-2 font-extrabold"
              style={{ fontSize: "34px", lineHeight: 1, letterSpacing: "-0.04em" }}
            >
              Upcoming runs
            </h1>
          </div>

          <div className="mb-6 flex flex-wrap gap-2">
            {FILTERS.map((f) => {
              const active = filter === f.id;
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setFilter(f.id)}
                  className="kb-anim kb-focus h-9 rounded-full px-4 font-bold"
                  style={{
                    fontSize: "13px",
                    letterSpacing: "-0.01em",
                    background: active ? INK : "transparent",
                    color: active ? "#FFFFFF" : "#5C5C55",
                    border: `1px solid ${active ? INK : LINE}`,
                    transition: `background-color 180ms ${MECH}, color 180ms ${MECH}`,
                  }}
                >
                  {f.label}
                </button>
              );
            })}
          </div>

          {bands.length === 0 ? (
            <div
              className="rounded-2xl border border-dashed border-[#E4E4DF] p-10 text-center"
            >
              <p className="font-extrabold" style={{ fontSize: "17px", letterSpacing: "-0.02em" }}>
                Nothing on the board yet
              </p>
              <p className="mt-1" style={{ fontSize: "13px", color: "#7A7A72" }}>
                No {FILTERS.find((f) => f.id === filter)?.label.toLowerCase()} scheduled this week. Post
                one and the club will see it.
              </p>
            </div>
          ) : (
            bands.map((band, bi) => (
              <section key={band.label} className={bi === 0 ? "" : "mt-2"}>
                <div
                  className="sticky top-14 z-20 -mx-1 flex items-center gap-3 px-1 py-3"
                  style={{ background: "rgba(246,246,243,0.92)", backdropFilter: "blur(8px)" }}
                >
                  <Kicker className="text-[#14171C]">{band.label}</Kicker>
                  <div className="h-px flex-1 bg-[#E4E4DF]" />
                  <span
                    className="font-semibold tabular-nums"
                    style={{ fontSize: "11px", color: "#9A9A92" }}
                  >
                    {band.events.length}
                  </span>
                </div>

                <div className="flex flex-col gap-3 pb-4">
                  {band.events.map((e, i) => (
                    <div
                      key={e.id}
                      style={{ animation: `kbRise 380ms ${SPRING} ${i * 40}ms both` }}
                      className="kb-anim"
                    >
                      <EventCard
                        event={e}
                        now={now}
                        hero={e.id === heroId}
                        going={rsvps.has(e.id)}
                        pending={pendingId === e.id}
                        onJoin={() => join(e)}
                        onLeave={() => leave(e)}
                      />
                    </div>
                  ))}
                </div>
              </section>
            ))
          )}
        </div>

        {/* ── Sidebar ─────────────────────────────────────────────────── */}
        <aside className="w-full shrink-0 lg:w-64">
          <div className="sticky top-24 flex flex-col gap-3">
            <div className="rounded-2xl bg-[#14171C] p-5" style={{ color: "#FFFFFF" }}>
              <Kicker className="text-[#FF5741]">Your week</Kicker>
              <p
                className="mt-3 font-extrabold tabular-nums leading-none"
                style={{ fontSize: "44px", letterSpacing: "-0.05em" }}
              >
                {rsvps.size}
              </p>
              <p className="mt-1" style={{ fontSize: "12px", color: "rgba(255,255,255,0.55)" }}>
                {rsvps.size === 1 ? "run on your calendar" : "runs on your calendar"}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 lg:grid-cols-1">
              <div
                className="rounded-2xl border border-[#E4E4DF] bg-white p-4"
              >
                <Kicker color="#9A9A92">Scheduled</Kicker>
                <p
                  className="mt-2 font-extrabold tabular-nums leading-none"
                  style={{ fontSize: "26px", letterSpacing: "-0.04em" }}
                >
                  {EVENTS.length}
                </p>
                <p className="mt-1" style={{ fontSize: "12px", color: "#7A7A72" }}>
                  runs this week
                </p>
              </div>
              <div
                className="rounded-2xl border border-[#E4E4DF] bg-white p-4"
              >
                <Kicker color="#9A9A92">Turnout</Kicker>
                <p
                  className="mt-2 font-extrabold tabular-nums leading-none"
                  style={{ fontSize: "26px", letterSpacing: "-0.04em" }}
                >
                  {totalGoing}
                </p>
                <p className="mt-1 flex items-center gap-1" style={{ fontSize: "12px", color: "#7A7A72" }}>
                  <Icon name="users" className="h-3 w-3" />
                  runners going
                </p>
              </div>
            </div>
          </div>
        </aside>
      </main>

      {/* ── Error toast ───────────────────────────────────────────────── */}
      {toast && (
        <div
          role="status"
          className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full bg-[#14171C] px-5 py-3 font-semibold text-white"
          style={{
            fontSize: "13px",
            boxShadow: "0 12px 32px -12px rgba(20,23,28,0.5)",
            animation: `kbRise 300ms ${SPRING} both`,
          }}
        >
          {toast}
        </div>
      )}
    </div>
  );
}
