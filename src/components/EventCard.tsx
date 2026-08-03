import type { AppStore } from "../lib/store";
import { dayLabel, monthDayLabel, type DatedRunEvent } from "../lib/dates";
import { GROUP_TYPE_LABELS, type City } from "../types";
import { Chip, Icon } from "./ui";

export function EventCard({
  event,
  city,
  store,
  onRsvp,
}: {
  event: DatedRunEvent;
  city: City;
  store: AppStore;
  onRsvp: () => void;
}) {
  const group = city.groups.find((g) => g.id === event.groupId);
  const rsvped = !!store.state.rsvped[event.id];
  const canRsvp = store.isVerified;

  return (
    <article
      className={`overflow-hidden rounded-2xl bg-white shadow-sm ring-1 transition-shadow ${
        event.isToday ? "ring-2 ring-[#c8f169]" : "ring-slate-200/70"
      }`}
    >
      <div className="flex gap-3.5 p-4">
        {/* Date block */}
        <div
          className={`flex w-14 shrink-0 flex-col items-center justify-center rounded-xl py-2 ${
            event.isToday ? "bg-[#0b2b22] text-[#c8f169]" : "bg-slate-100 text-slate-700"
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
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-[15px] font-bold leading-snug text-slate-900">{event.title}</h3>
            {event.externalUrl ? (
              <a
                href={event.externalUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`${event.title} — external details (opens in new tab)`}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-slate-400 ring-1 ring-slate-200 active:bg-slate-50"
              >
                <Icon name="external" className="h-4 w-4" />
              </a>
            ) : null}
          </div>

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
            {group ? (
              <span className="ml-1.5 font-normal text-slate-400">· {GROUP_TYPE_LABELS[group.groupType]}</span>
            ) : null}
          </p>

          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <Chip tone={event.invite === "Open to all" ? "emerald" : "amber"}>{event.invite}</Chip>
            <Chip tone="outline">
              <Icon name="flag" className="h-3 w-3" /> {event.distanceLabel}
            </Chip>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 border-t border-slate-100 px-4 py-2.5">
        <span className="text-xs font-semibold text-slate-500">{dayLabel(event.date, new Date())}</span>
        <span className="text-xs text-slate-300">·</span>
        <button
          type="button"
          onClick={onRsvp}
          disabled={!canRsvp}
          className={`inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-full text-sm font-semibold transition-colors ${
            rsvped
              ? "bg-emerald-100 text-emerald-800"
              : canRsvp
                ? "bg-[#c8f169] text-[#0b2b22] active:bg-[#b9e355]"
                : "bg-slate-100 text-slate-500"
          }`}
        >
          {rsvped ? (
            <>
              <Icon name="check" className="h-4 w-4" /> You're in — see you there
            </>
          ) : canRsvp ? (
            <>
              <Icon name="rsvp" className="h-4 w-4" /> RSVP
            </>
          ) : (
            <>
              <Icon name="lock" className="h-4 w-4" /> Sign in to RSVP
            </>
          )}
        </button>
      </div>
    </article>
  );
}
