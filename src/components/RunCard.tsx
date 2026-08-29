import { useState, useEffect, useRef, type ReactNode } from "react";
import { Icon } from "./ui";

/* ═══════════════════════════════════════════════════════════════════════════
   KIMBIO — RUN CARD (shared)
   Composed by BOTH the signed-in DepartureBoard and the public marketing
   preview, rather than either growing a "compact" flag. A boolean gating
   masthead, filters, sidebar, RSVP, CTA and avatars would be five behaviors
   behind one flag — it rots, and it makes DepartureBoard do two jobs.

   Named RunCard, not EventCard: src/components/EventCard.tsx already exists and
   is a different component (the weekly list row used by EventsPage).

   PRIVACY: `attendees` is OPTIONAL, and that is a semantic distinction rather
   than a display mode. On the public page we genuinely do not have identities
   and must not — showing real members' initials to anonymous visitors would
   violate D2 and contradict "private by default" on the very page that claims
   it. Absent attendees renders the going COUNT alone.
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
  /**
   * Real attendee identities. OPTIONAL and must be OMITTED on any public
   * surface: rendering members' initials to anonymous visitors would violate
   * D2 and contradict "private by default". Absent, the going count renders
   * alone — which is still real proof the community is active.
   */
  attendees?: Person[];
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


const TYPE_LABEL: Record<EventType, string> = { track: "Track", group: "Group run", long: "Long run", trail: "Trail" };

const MS_MIN = 60_000;

const minutesUntil = (date: Date, now: Date): number =>
  Math.round((date.getTime() - now.getTime()) / MS_MIN);

const TONES: string[] = ["#14171C", "#3C4450", "#8A5A4E", "#5A6B57"];
const dowFmt = new Intl.DateTimeFormat("en-US", { weekday: "short" });
const timeFmt = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" });


function splitTime(date: Date): { clock: string; meridiem: string } {
  const [clock, meridiem] = timeFmt.format(date).split(" ");
  return { clock, meridiem };
}

interface KickerProps {
  children: ReactNode;
  /** For genuinely dynamic or non-brand colors only - a fixed brand color (ink/coral) should go through className instead (e.g. "text-[#FF5741]"). */
  color?: string;
  className?: string;
}

export function Kicker({ children, color, className = "" }: KickerProps) {
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
  attendees?: Person[];
  count: number;
  inverted: boolean;
  justJoined: boolean;
}

function AvatarStack({ attendees, count, inverted, justJoined }: AvatarStackProps) {
  const ringColor = inverted ? INK_SOFT : "#FFFFFF";
  const shown = (attendees ?? []).slice(0, 4);
  return (
    <div className="flex items-center">
      <div className="flex items-center">
        {justJoined && (
          <span
            className="kb-anim relative flex h-7 w-7 items-center justify-center rounded-full bg-[#FF5741] font-bold text-[#14171C]"
            style={{
              fontSize: "11px",
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
              fontSize: "11px",
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
        className={`${shown.length || justJoined ? "ml-2" : ""} font-semibold tabular-nums`}
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
      className="kb-anim kb-focus relative flex h-11 shrink-0 items-center justify-center gap-1.5 overflow-hidden rounded-full font-bold"
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
  /** When false, attendee identities are never rendered regardless of what is passed (D2). */
  showAttendees?: boolean;
  event: RunEvent;
  now: Date;
  hero: boolean;
  going: boolean;
  pending: boolean;
  onJoin: () => void;
  onLeave: () => void;
}

export function EventCard({ event, now, hero, going, pending, onJoin, onLeave, showAttendees = true }: EventCardProps) {
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);

  const mins = minutesUntil(event.startsAt, now);
  const imminent = mins > 0 && mins <= 90;
  const inverted = hero;

  const { clock, meridiem } = splitTime(event.startsAt);

  const gutterBg = going || hovered ? CORAL : inverted ? "#000000" : INK;
  const gutterFg = going || hovered ? INK : "#FFFFFF";
  const gutterMuted = going || hovered ? "rgba(20,23,28,0.65)" : "rgba(255,255,255,0.5)";

  // paceHigh is empty when paceLow carries a policy label ("No-drop") rather
  // than the low end of a numeric range. Only join the two when there is a
  // genuine range to show.
  const pace = event.paceHigh ? `${event.paceLow}–${event.paceHigh}` : event.paceLow;

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
              attendees={showAttendees ? event.attendees : undefined}
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
