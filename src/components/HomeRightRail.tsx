import { Link } from "react-router-dom";
import type { City } from "../types";
import { formatRaceDate } from "../lib/dates";

export function HomeRightRail({ city }: { city: City }) {
  return <aside className="desktop-home-rail" aria-label="Local highlights">
    <section><p className="desktop-rail-kicker">This week</p><h2>{city.events.length} group runs</h2><p>Browse the local schedule and find your next start line.</p><Link to="/events">View all events →</Link></section>
    <section><p className="desktop-rail-kicker">Upcoming races</p>{city.races.slice(0, 3).map((race) => <Link className="desktop-rail-item" to="/races" key={race.id}><b>{race.name}</b><span>{formatRaceDate(race.date)} · {race.distance}</span></Link>)}<Link to="/races">See all races →</Link></section>
    <section><p className="desktop-rail-kicker">Nearby groups</p>{city.groups.slice(0, 3).map((group) => <Link className="desktop-rail-item" to="/groups" key={group.id}><b>{group.name}</b><span>{group.groupType === "rrca-chartered" ? "RRCA-chartered club" : "Community run group"}</span></Link>)}<Link to="/groups">See all groups & clubs →</Link></section>
  </aside>;
}
