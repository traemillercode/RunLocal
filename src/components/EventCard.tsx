import { Link } from "react-router-dom";
import { Chip, Icon } from "./ui";
import { GROUP_TYPE_LABELS, type City } from "../types";
import { dayLabel, monthDayLabel, type DatedRunEvent } from "../lib/dates";
interface EventCardProps {
  event: DatedRunEvent;
  city: City;
  rsvped: boolean;
  /** Verified runners only. When false the button opens the verified gate. */
  canRsvp: boolean;
  onRsvp: () => void;
  /** Server-driven owner highlights (featured/pinned). */
  featured?: boolean;
  pinned?: boolean;
  /**
   * Server-driven RRCA badge state for the group. When undefined the seeded
   * groupType label is used (backend unreachable / not yet loaded).
   */
  groupBadge?: boolean;
}
export function EventCard({ event, city, rsvped, canRsvp, onRsvp, featured = false, pinned = false, groupBadge }: EventCardProps) {
  const group = city.groups.find((g) => g.id === event.groupId);
  const rrca = groupBadge ?? group?.groupType === "rrca-chartered";
  const label = group ? (rrca ? GROUP_TYPE_LABELS["rrca-chartered"] : GROUP_TYPE_LABELS.community) : null;
  return (
    <article
      className={`relative overflow-hidden rounded-2xl bg-white shadow-sm ring-1 transition-shadow ${
        event.isToday ? "ring-2 ring-[#FF5741]" : "ring-slate-200/70"
      }`}
    >
      {/* The whole card body is the primary tappable action — it navigates to the
          in-app event detail view. The external-link icon and RSVP button live
          OUTSIDE this link so they stay separate secondary actions. */}
      <Link to={`/events/${event.id}`} aria-label={`${event.title} — event details`} className="block">
        <div className="flex gap-3.5 p-4">
          {/* Date block */}
          <div
            className={`flex w-14 shrink-0 flex-col items-center justify-center rounded-xl py-2 ${
              event.isToday ? "bg-[#14171C] text-[#FF5741]" : "bg-slate-100 text-slate-700"
            }`}
          >
            <span className="text-[10px] font-bold uppercase tracking-wider">{event.dayAbbrev}</span>
            <span className="text-xl font-extrabold leading-tight">{event.date.getDate()}</span>
            <span className="text-[10px] font-semibold uppercase text-slate-400">
              {monthDayLabel(event.date).split(" ")[0]}
            </span>
          </div>
          {/* Body */}
          <div className="min-w-0 flex-1">
            <h3 className="pr-11 text-[15px] font-bold leading-snug text-slate-900">{event.title}</h3>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-slate-600">
              <span className="inline-flex items-center gap-1">
                <Icon name="clock" className="h-3.5 w-3.5 text-slate-400" />
                {event.time}
              </span>
              <span className="inline-flex items-center gap-1">
                <Icon name="mapPin" className="h-3.5 w-3.5 text-slate-400" />
                <span className="truncate">{event.location}</span>
              </span>
            </p>
            <p className="mt-1.5 text-[13px] font-medium text-slate-500">
              {group ? group.name : "Local group"}
              {label ? (
                <span className="ml-1.5 font-normal text-slate-400">· {label}</span>
              ) : null}
            </p>
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
              {featured ? (
                <Chip tone="volt">
                  <Icon name="spark" className="h-3 w-3" /> Featured
                </Chip>
              ) : null}
              {pinned ? (
                <Chip tone="amber">
                  <Icon name="pin" className="h-3 w-3" /> Pinned
                </Chip>
              ) : null}
              <Chip tone={event.invite === "Open to all" ? "emerald" : "amber"}>{event.invite}</Chip>
              <Chip tone="outline">
                <Icon name="flag" className="h-3 w-3" /> {event.distanceLabel}
              </Chip>
            </div>
          </div>
        </div>
      </Link>
      {/* External link — separate secondary action, opens in a new tab and never
          triggers the internal /events/:id route. */}
      {event.externalUrl ? (
        <a
          href={event.externalUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`${event.title} — external details (opens in new tab)`}
          className="absolute right-4 top-4 z-10 grid h-9 w-9 place-items-center rounded-full text-slate-400 ring-1 ring-slate-200 active:bg-slate-50"
        >
          <Icon name="external" className="h-4 w-4" />
        </a>
      ) : null}
      <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 px-4 py-2.5">
        <span className="min-w-0 text-xs font-semibold text-slate-500">{dayLabel(event.date, new Date())}</span>
        <span className="text-xs text-slate-300">·</span>
        <button
          type="button"
          onClick={onRsvp}
          className={`inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-full text-sm font-semibold transition-colors ${
            rsvped
              ? "bg-emerald-100 text-emerald-800"
              : canRsvp
                ? "bg-[#FF5741] text-[#14171C] active:bg-[#E44735]"
                : "bg-slate-100 text-slate-500 active:bg-slate-200"
          }`}
        >
          {rsvped ? (
            <>
              <Icon name="check" className="h-4 w-4" /> Remove from My Runs
            </>
          ) : canRsvp ? (
            <>
              <Icon name="rsvp" className="h-4 w-4" /> Add to My Runs
            </>
          ) : (
            <>
              <Icon name="rsvp" className="h-4 w-4" /> Add to My Runs
            </>
          )}
        </button>
      </div>
    </article>
  );
}