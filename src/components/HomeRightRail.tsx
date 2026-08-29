import type { City } from "../types";
import { formatRaceDate } from "../lib/dates";
import { upcomingRunCount } from "../lib/upcomingRuns";
import { RailCard, RailItemLink, RailSeeAll, RailStack } from "./RailCard";

export function HomeRightRail({ city }: { city: City }) {
  // Was city.events.length — the raw count of weekly SLOTS, unfiltered by date.
  // On the Saturday of an Aug 24-30 week that read "7 group runs" while the
  // list beside it showed 1, because the list filtered already-started
  // occurrences and this did not. Same resolver as the board now, so the
  // number cannot disagree with what it sits next to.
  //
  // Canonical events are not fetched here: this is a static rail, and passing
  // null means seed events only. The count is therefore conservative rather
  // than wrong — it can undercount community submissions, never overcount.
  const runCount = upcomingRunCount(city, null);
  return (
    <RailStack ariaLabel="Local highlights">
      <RailCard kicker="This week" title={`${runCount} ${runCount === 1 ? "group run" : "group runs"}`} footer={<RailSeeAll to="/events">View all events →</RailSeeAll>}>
        <p className="mt-1 text-[13px] leading-relaxed text-slate-500">Browse the local schedule and find your next start line.</p>
      </RailCard>
      <RailCard kicker="Upcoming races" footer={<RailSeeAll to="/races">See all races →</RailSeeAll>}>
        {city.races.slice(0, 3).map((race) => (
          <RailItemLink key={race.id} to="/races" title={race.name} meta={`${formatRaceDate(race.date)} · ${race.distance}`} />
        ))}
      </RailCard>
      <RailCard kicker="Nearby groups" footer={<RailSeeAll to="/groups">See all groups & clubs →</RailSeeAll>}>
        {city.groups.slice(0, 3).map((group) => (
          <RailItemLink
            key={group.id}
            to="/groups"
            title={group.name}
            meta={group.groupType === "rrca-chartered" ? "RRCA-chartered club" : "Community run group"}
          />
        ))}
      </RailCard>
    </RailStack>
  );
}
