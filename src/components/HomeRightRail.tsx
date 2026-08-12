import type { City } from "../types";
import { formatRaceDate } from "../lib/dates";
import { RailCard, RailItemLink, RailSeeAll, RailStack } from "./RailCard";

export function HomeRightRail({ city }: { city: City }) {
  return (
    <RailStack ariaLabel="Local highlights">
      <RailCard kicker="This week" title={`${city.events.length} group runs`} footer={<RailSeeAll to="/events">View all events →</RailSeeAll>}>
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
