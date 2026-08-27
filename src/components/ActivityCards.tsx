import { Link } from "react-router-dom";
import type { ConnectionActivityCard, PublicActivityCard } from "../lib/api";
import {
  formatActivityDate,
  formatActivityDistance,
  formatActivityDuration,
  providerLabel,
} from "../lib/activityFormat";

/**
 * Presentational activity cards — no hooks, driven entirely by props so SSR
 * tests render the real markup. Privacy is enforced server-side (B1: the
 * server only returns cards the current viewer may see); these components only
 * render what the payload contains.
 */

/** A single runner's activity card: distance · duration, provider attribution, shared date. */
export function ActivityCardView({ card }: { card: PublicActivityCard }) {
  return (
    <li className="flex items-start gap-3 px-4 py-3.5">
      <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#FF5741]/15 text-[#14171C]">
        <IconRun />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-bold text-slate-900">
          {formatActivityDistance(card.distanceMeters)} <span className="text-slate-400">·</span> {formatActivityDuration(card.durationSeconds)}
        </p>
        <p className="mt-0.5 text-[12px] font-semibold text-slate-400">
          {providerLabel(card.provider)}
          {card.attribution ? ` · ${card.attribution}` : ""} · {formatActivityDate(card.sharedAt)}
        </p>
      </div>
    </li>
  );
}

/** A connections-feed card: owner identity (name/username/avatar) linked to the public profile + the card itself. */
export function ConnectionActivityCardView({ card }: { card: ConnectionActivityCard }) {
  const { owner } = card;
  return (
    <li className="px-4 py-3.5">
      <Link to={`/runners/${owner.accountId}`} className="flex min-w-0 items-center gap-3">
        {owner.profilePhotoUrl ? (
          <img src={owner.profilePhotoUrl} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover ring-2 ring-slate-100" />
        ) : (
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#14171C] text-[12px] font-extrabold text-white ring-2 ring-slate-100">
            {initials(owner.name)}
          </span>
        )}
        <span className="min-w-0">
          <span className="block truncate text-[14px] font-semibold text-slate-900">{owner.name}</span>
          {owner.username ? <span className="block truncate text-xs text-slate-500">@{owner.username}</span> : null}
        </span>
      </Link>
      <div className="mt-2.5">
        <p className="text-[14px] font-bold text-slate-900">
          {formatActivityDistance(card.distanceMeters)} <span className="text-slate-400">·</span> {formatActivityDuration(card.durationSeconds)}
        </p>
        <p className="mt-0.5 text-[12px] font-semibold text-slate-400">
          {providerLabel(card.provider)}
          {card.attribution ? ` · ${card.attribution}` : ""} · {formatActivityDate(card.sharedAt)}
        </p>
      </div>
    </li>
  );
}

/** Ordered card list (already server-sorted). */
export function ActivityCardList({ cards }: { cards: PublicActivityCard[] }) {
  return (
    <ul aria-label="Logged runs" className="divide-y divide-slate-100 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/70">
      {cards.map((c) => (
        <ActivityCardView key={c.id} card={c} />
      ))}
    </ul>
  );
}

function IconRun() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current" aria-hidden="true">
      <path d="M13.5 5.5a1.75 1.75 0 1 0 0-3.5 1.75 1.75 0 0 0 0 3.5zM18.5 9c-.8 0-1.5.7-1.5 1.5s.7 1.5 1.5 1.5 1.5-.7 1.5-1.5-.7-1.5-1.5-1.5zM14 10l-2.2-3.2a2 2 0 0 0-1.6-.9H6.5A1.5 1.5 0 0 0 5 7.4v4.1h2V7.5h2.2L11 10l-3 4.9-.9 4.2h2l.8-3 2.9-1 .7 3h2.5l-.8-3.2a2 2 0 0 0-.9-1.2L13 12.6l.5-1.2 2.4 1.6H19V11h-2.8l-2.2-1z" />
    </svg>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}
