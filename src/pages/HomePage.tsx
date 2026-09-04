import { useEffect, useMemo, useState } from "react";
import { localISODate } from "../lib/dates";
import { Link } from "react-router-dom";
import * as api from "../lib/api";
import { useAccount } from "../state/account";
import { Icon } from "../components/ui";
import { HomeRightRail } from "../components/HomeRightRail";
import { upcomingRuns } from "../lib/upcomingRuns";
import { useDeadEnd } from "../lib/friction";
import type { IconName } from "../components/ui";
import type { City } from "../types";

/**
 * SIGNED-IN HOME (roadmap 1.2).
 *
 * The rule this is designed against: every element is either something you ACT
 * ON or something that CHANGED. Nothing that is merely true. A static list of
 * things that are always the case belongs on a tab, not here — that is the
 * difference between a home page and a second board.
 *
 * Each panel is hidden entirely when it has nothing to say, rather than
 * rendering an empty box. Three panels where one is always blank is worse than
 * two that work.
 *
 * DELIBERATELY ABSENT: "what is my group doing". getMyGroups() exists but no
 * endpoint returns upcoming runs across your memberships, and in a three-club
 * city those would largely BE the runs you already RSVP'd to — so the panel
 * would render "Next up" twice. Cut rather than built empty; revisit when real
 * use shows people belong to clubs whose runs they are not already tracking.
 */

/** "Today · 6:00 PM" — short enough that three rows fit a phone without wrapping. */
/*
 * LOCAL DATE PARTS, NOT toISOString().
 *
 * `new Date("2026-08-30T00:00:00")` is LOCAL midnight, and toISOString()
 * converts to UTC — which in Columbia (UTC-5) rolls the date BACKWARDS to the
 * 29th. So "tomorrow" computed as today, and a run on the 30th read "Today" on
 * Home while the detail page correctly said "Tomorrow".
 *
 * A runner acts on that. It is the one class of bug where being wrong is worse
 * than showing nothing.
 *
 * The fix is to never let a local date pass through a UTC serialiser. Reading
 * the parts back off the local Date keeps it in the calendar the person is
 * standing in.
 */
function whenLabel(dateISO: string, time: string, today: string): string {
  const tomorrow = new Date(`${today}T00:00:00`);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowISO = localISODate(tomorrow);
  if (dateISO === today) return `Today · ${time}`;
  if (dateISO === tomorrowISO) return `Tomorrow · ${time}`;
  const d = new Date(`${dateISO}T00:00:00`);
  return `${new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(d)} · ${time}`;
}

export function HomePage({ city }: { city: City }) {
  const { me, role } = useAccount();
  const canRsvp = role === "verified";
  const displayName = me?.status === "signed_in" ? me.account.name.split(/\s+/)[0] : "";

  const [myRuns, setMyRuns] = useState<api.MyRunView[] | null>(null);
  const [notifications, setNotifications] = useState<api.InAppNotification[]>([]);
  const [plan, setPlan] = useState<api.TrainingPlanView | null>(null);
  const [memberships, setMemberships] = useState<api.MyGroupMembership[]>([]);
  const [clubs, setClubs] = useState<api.ClubWeekRow[]>([]);
  const [canonical, setCanonical] = useState<api.CanonicalEvent[] | null>(null);

  useEffect(() => {
    let alive = true;
    void api.getMyRuns().then((r) => { if (alive && r.ok) setMyRuns(r.data.runs); });
    void api.getNotifications().then((r) => { if (alive && r.ok) setNotifications(r.data.notifications); });
    void api.getTrainingPlan().then((r) => { if (alive && r.ok) setPlan(r.data.plan); });
    void api.getMyGroups().then((r) => { if (alive && r.ok) setMemberships(r.data.memberships); });
    void api.getClubWeek().then((r) => { if (alive && r.ok) setClubs(r.data.clubs); });
    void api.getCanonicalEvents(city.id).then((r) => { if (alive && r.ok) setCanonical(r.data.events); });
    return () => { alive = false; };
  }, [city.id]);

  /* Local, not UTC — see localISO. In a negative offset this was yesterday for
     the last five hours of every day, which shifted every comparison below. */
  const today = localISODate(new Date());

  /** Commitments, soonest first. Past runs belong in My Runs, not on Home. */
  const nextUp = useMemo(
    () =>
      (myRuns ?? [])
        .filter((r) => (r.runDate ?? r.date) >= today)
        .sort((a, b) => (a.runDate ?? a.date).localeCompare(b.runDate ?? b.date))
        .slice(0, 3),
    [myRuns, today],
  );

  const unread = useMemo(() => notifications.filter((n) => n.readAt === null).slice(0, 4), [notifications]);

  /** The single most joinable run, shown only to someone with no commitments. */
  const suggestion = useMemo(
    () => (nextUp.length === 0 ? upcomingRuns(city, canonical)[0] ?? null : null),
    [nextUp.length, city, canonical],
  );

  const loading = myRuns === null;

  // Home with nothing to act on and nothing changed is a genuine dead end, and
  // it is the state every beta account starts in — so it is worth measuring.
  useDeadEnd("home-nothing-to-do", !loading && nextUp.length === 0 && suggestion === null && unread.length === 0);

  return (
    <div className="desktop-browse-layout mx-auto w-full max-w-md px-4 pb-32 pt-4">
      <div className="desktop-two-column">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">
            {displayName ? `Hi, ${displayName}` : "Home"}
          </h1>
          <p className="mt-0.5 text-sm font-medium text-slate-500">
            {new Intl.DateTimeFormat("en-US", { weekday: "long", day: "numeric", month: "long" }).format(new Date())}
          </p>

          {nextUp.length > 0 ? (
            <section className="mt-6" aria-labelledby="home-next">
              <h2 id="home-next" className="text-[11px] font-bold uppercase tracking-widest text-[#FF5741]">Next up</h2>
              <ul className="mt-2 space-y-2">
                {nextUp.map((run) => (
                  <li key={run.id}>
                    <Link
                      to={run.kind === "solo" ? "/my-runs" : `/events/${encodeURIComponent(run.eventId)}`}
                      className="block rounded-2xl bg-white p-4 ring-1 ring-slate-200/70"
                    >
                      <p className="text-[12px] font-bold text-slate-500">{whenLabel(run.runDate ?? run.date, run.time, today)}</p>
                      <p className="mt-0.5 text-[15px] font-bold text-slate-900">{run.title}</p>
                      <p className="mt-0.5 text-[13px] text-slate-500">{run.location}</p>
                    </Link>
                  </li>
                ))}
              </ul>
              <Link to="/my-runs" className="mt-2 inline-block text-[13px] font-bold text-[#FF5741]">All my runs →</Link>
            </section>
          ) : loading ? null : (
            /*
             * EMPTY STATE — what every beta account sees on day one.
             *
             * States the true thing in one plain line, then puts a REAL run in
             * front of you with a working action. No "0 runs", no encouraging
             * copy wrapped around a zero: the competitor's "The miles are
             * adding up / 0.00" fails precisely because the encouragement makes
             * the emptiness louder.
             */
            <section className="mt-6" aria-labelledby="home-next">
              <h2 id="home-next" className="text-[11px] font-bold uppercase tracking-widest text-[#FF5741]">Next up</h2>
              <p className="mt-2 text-[15px] text-slate-600">You haven&apos;t RSVP&apos;d to anything yet.</p>
              {suggestion ? (
                <div className="mt-3 rounded-2xl bg-white p-4 ring-1 ring-slate-200/70">
                  <p className="text-[12px] font-bold text-slate-500">
                    {whenLabel(localISODate(suggestion.date), suggestion.time, today)}
                  </p>
                  <p className="mt-0.5 text-[15px] font-bold text-slate-900">{suggestion.title}</p>
                  <p className="mt-0.5 text-[13px] text-slate-500">{suggestion.location} · {suggestion.distanceLabel}</p>
                  {/*
                    A pending account CANNOT RSVP — the server returns 403
                    verified_runner_required — so it must not be handed a button
                    that fails. The run still renders, because seeing a real
                    Tuesday run is the point; only the action changes, to the
                    step that actually unblocks them.
                  */}
                  <Link
                    to={canRsvp ? `/events/${encodeURIComponent(suggestion.id)}` : "/verify"}
                    className="mt-3 flex h-11 items-center justify-center rounded-xl bg-[#14171C] text-[14px] font-bold text-white"
                  >
                    {canRsvp ? "See this run" : "Verify to RSVP"}
                  </Link>
                </div>
              ) : null}
              <Link to="/events" className="mt-3 inline-block text-[13px] font-bold text-[#FF5741]">Find a run →</Link>
            </section>
          )}

          {/*
            THE CLUB, NOT THE ACCOUNT. Home was three first-person panels — your
            next run, your notifications, your training week — which tells you
            about your account and nothing about the community you joined.

            Not a feed: an aggregate with your participation in it. "Columbia
            Track Club ran 4 times this week. You were at 2."

            The club's number comes from the SCHEDULE, already public on the
            board; only your own attendance is read. Nothing here aggregates
            other people.
          */}
          {clubs.length > 0 ? (
            <section className="mt-7" aria-labelledby="home-clubs">
              <h2 id="home-clubs" className="text-[11px] font-bold uppercase tracking-widest text-[#FF5741]">
                Your clubs this week
              </h2>
              <ul className="mt-2 space-y-2">
                {clubs.map((c) => (
                  <li key={c.groupId} className="rounded-2xl bg-white px-4 py-3 shadow-sm ring-1 ring-slate-200/70">
                    <p className="text-[15px] font-bold text-slate-900">
                      {c.groupName} ran {c.runsHeld} time{c.runsHeld === 1 ? "" : "s"}
                    </p>
                    {/*
                      Stated as participation rather than as a score. "You were
                      at 2" is a fact; "2 of 4" invites reading it as a ratio
                      you are failing, which is the competitive framing this
                      product deliberately avoids.
                    */}
                    <p className="mt-0.5 text-[13px] text-slate-600">
                      {c.youWereAt === 0
                        ? "You haven't been out with them yet this week."
                        : `You were at ${c.youWereAt}.`}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}


          {unread.length > 0 ? (
            <section className="mt-7" aria-labelledby="home-changed">
              {/*
                "Since you were here", not a timestamp. There is no lastSeenAt on
                the account, so this is really "unread" — which drifts if you
                read something elsewhere. The heading implies recency without
                claiming a time we cannot substantiate.
              */}
              <h2 id="home-changed" className="text-[11px] font-bold uppercase tracking-widest text-[#FF5741]">Since you were here</h2>
              <ul className="mt-2 space-y-1.5">
                {unread.map((n) => (
                  <li key={n.id} className="rounded-xl bg-white px-4 py-3 ring-1 ring-slate-200/70">
                    <p className="text-[14px] font-semibold text-slate-900">{n.title}</p>
                    {n.body ? <p className="mt-0.5 text-[13px] text-slate-500">{n.body}</p> : null}
                  </li>
                ))}
              </ul>
              <Link to="/notifications" className="mt-2 inline-block text-[13px] font-bold text-[#FF5741]">All notifications →</Link>
            </section>
          ) : null}

          {plan ? (
            <section className="mt-7" aria-labelledby="home-plan">
              <h2 id="home-plan" className="text-[11px] font-bold uppercase tracking-widest text-[#FF5741]">This week</h2>
              <Link to="/training-plan" className="mt-2 block rounded-2xl bg-white p-4 ring-1 ring-slate-200/70">
                <p className="text-[15px] font-bold text-slate-900">Week {plan.currentWeek} of {plan.totalWeeks}</p>
                <p className="mt-0.5 text-[13px] text-slate-500">{plan.customLabel ?? plan.planType.replace(/_/g, " ")}</p>
              </Link>
            </section>
          ) : null}

          <NextSteps canRsvp={canRsvp} hasPlan={plan !== null} groupCount={memberships.length} cityGroupCount={city.groups.length} cityName={city.name} />
        </div>
        <HomeRightRail city={city} />
      </div>
    </div>
  );
}

/**
 * Promoted beyond the empty state per review: a returning user with commitments
 * but no plan should still see "Start a plan"; one who has never joined a club
 * should still see "Join a club". That makes Home PROGRESSIVE rather than a
 * dashboard that is thin early and static later — and it is the one panel that
 * cannot render empty, because there is always a next step.
 */
function NextSteps({
  canRsvp, hasPlan, groupCount, cityGroupCount, cityName,
}: { canRsvp: boolean; hasPlan: boolean; groupCount: number; cityGroupCount: number; cityName: string }) {
  const steps: { to: string; label: string; meta: string; icon: IconName }[] = [];
  // Ordered by what unblocks the most: verification gates RSVP entirely,
  // joining a club gates the community, a plan is optional depth.
  if (!canRsvp) steps.push({ to: "/verify", label: "Verify your account", meta: "so you can RSVP", icon: "shield" });
  if (groupCount === 0 && cityGroupCount > 0) {
    steps.push({ to: "/groups", label: "Join a club", meta: `${cityGroupCount} in ${cityName}`, icon: "users" });
  }
  if (!hasPlan) steps.push({ to: "/training-plan", label: "Start a training plan", meta: "Build your weeks", icon: "calendar" });
  if (steps.length === 0) return null;

  return (
    <section className="mt-7" aria-labelledby="home-next-steps">
      <h2 id="home-next-steps" className="text-[11px] font-bold uppercase tracking-widest text-slate-400">Also worth doing</h2>
      <ul className="mt-2 space-y-1.5">
        {steps.map((s) => (
          <li key={s.to}>
            <Link to={s.to} className="flex min-h-11 items-center gap-3 rounded-xl bg-white px-4 py-3 ring-1 ring-slate-200/70">
              <Icon name={s.icon} className="h-4 w-4 shrink-0 text-slate-400" />
              <span className="flex-1">
                <span className="block text-[14px] font-bold text-slate-900">{s.label}</span>
                <span className="block text-[12px] text-slate-500">{s.meta}</span>
              </span>
              <Icon name="chevronRight" className="h-4 w-4 shrink-0 text-slate-300" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
