import type { City, ForumPost, Race, RunEvent, RunGroup } from "../types";

// ---------------------------------------------------------------------------
// Seed data for the Columbia, MO launch city.
// NOTE: this is illustrative, locally-seeded MVP content — not a live
// community feed. External links point at the real organizers' sites where
// they exist; dates/distances are sample data. Group type labels are
// admin-assigned in this dataset (see types.ts).
// ---------------------------------------------------------------------------

const COLUMBIA_GROUPS: RunGroup[] = [
  {
    id: "ctc",
    name: "Columbia Track Club",
    groupType: "rrca-chartered", // admin-assigned label in this seed dataset
    website: "https://www.columbiatrackclub.com/",
  },
  {
    id: "runcomo",
    name: "RunCoMO",
    groupType: "community",
    website: "https://www.facebook.com/runcomo/",
  },
  {
    id: "fleetfeet",
    name: "Fleet Feet Columbia",
    groupType: "community",
    website: "https://www.fleetfeet.com/columbiamo",
  },
  {
    id: "mizzou",
    name: "Mizzou Running Club",
    groupType: "community",
  },
];

// Recurring weekly slots. The UI resolves dayOfWeek against the *current*
// week at render time, so "this week" is always correct.
const COLUMBIA_EVENTS: RunEvent[] = [
  {
    id: "mon-social",
    groupId: "runcomo",
    title: "Monday Evening Social Run",
    dayOfWeek: 0,
    time: "6:00 PM",
    location: "Flat Branch Park — south shelter",
    distanceLabel: "3–5 mi, no-drop pace",
    invite: "Open to all",
    externalUrl: "https://www.facebook.com/runcomo/",
  },
  {
    id: "tue-track",
    groupId: "ctc",
    title: "Tuesday Night Track",
    dayOfWeek: 1,
    time: "6:00 PM",
    location: "Walton Stadium — University of Missouri",
    distanceLabel: "1–8 mi intervals, all paces",
    invite: "Open to all",
    externalUrl: "https://www.columbiatrackclub.com/",
  },
  {
    id: "wed-hills",
    groupId: "runcomo",
    title: "Wednesday Hills @ Grindstone",
    dayOfWeek: 2,
    time: "6:00 AM",
    location: "Grindstone Nature Area — trailhead lot",
    distanceLabel: "4–6 mi, hilly",
    invite: "Members + guests",
  },
  {
    id: "wed-kickstart",
    groupId: "fleetfeet",
    title: "Kickstart Run Club",
    dayOfWeek: 2,
    time: "6:00 PM",
    location: "Fleet Feet Columbia — starts at the store",
    distanceLabel: "2–4 mi, walkers welcome",
    invite: "Open to all",
    externalUrl: "https://www.fleetfeet.com/columbiamo",
  },
  {
    id: "thu-mizzou",
    groupId: "mizzou",
    title: "Mizzou Sunset Loop",
    dayOfWeek: 3,
    time: "6:30 PM",
    location: "Mizzou Rec — steps by the south entrance",
    distanceLabel: "3–5 mi, campus loop",
    invite: "Open to all",
  },
  {
    id: "sat-long",
    groupId: "ctc",
    title: "Saturday Long Run: MKT Trail",
    dayOfWeek: 5,
    time: "7:00 AM",
    location: "Cosmo Park — west lot",
    distanceLabel: "6–12 mi, group splits by pace",
    invite: "Members + guests",
    externalUrl: "https://www.columbiatrackclub.com/",
  },
  {
    id: "sun-recovery",
    groupId: "runcomo",
    title: "Sunday Recovery Run",
    dayOfWeek: 6,
    time: "8:00 AM",
    location: "Stephens Lake Park — east beach lot",
    distanceLabel: "3–4 mi, easy",
    invite: "Open to all",
  },
];

// One-off race listings with external registration links.
const COLUMBIA_RACES: Race[] = [
  {
    id: "r1",
    name: "Roots N Blues Half Marathon & 5K",
    date: "2026-10-04",
    distance: "13.1 mi / 5K",
    location: "The District — downtown Columbia",
    organizer: "Roots N Blues Festival",
    price: "from $35",
    registrationUrl: "https://www.rootnbluesfestival.com/",
    registrationOpen: true,
    registrationNote: "Register on the organizer's site",
  },
  {
    id: "r2",
    name: "Show-Me State Games 5K & 10K",
    date: "2026-07-11",
    distance: "5K / 10K",
    location: "University of Missouri campus",
    organizer: "Show-Me State Games",
    price: "from $30",
    registrationUrl: "https://www.smsg.org/",
    registrationOpen: true,
    registrationNote: "Register on the organizer's site",
  },
  {
    id: "r3",
    name: "Columbia Turkey Trot 5K",
    date: "2026-11-26",
    distance: "5K",
    location: "Cosmo Park",
    organizer: "Columbia Parks & Recreation",
    price: "TBA",
    registrationUrl: "https://www.comoparks.org/",
    registrationOpen: false,
    registrationNote: "Registration opens this fall",
  },
];

const COLUMBIA_FORUM: ForumPost[] = [
  {
    id: "p1",
    section: "announcements",
    title: "Welcome to Run Local — Columbia is live!",
    body: "Columbia, MO is our launch city. Browse this week's group runs, check out the races tab, and join the conversation. Heads-up: this is a preview build — the data you see is sample seed content, and verification & posting launch in a later phase.",
    author: "Run Local Team",
    authorNote: "Official",
    createdAt: "Aug 1",
    pinned: true,
    replies: 6,
  },
  {
    id: "p2",
    section: "announcements",
    title: "Columbia Track Club — Tuesday Night Track is on",
    body: "Summer track series continues every Tuesday at Walton Stadium, 6:00 PM. Warm-up at 5:45, intervals from 400s to mile repeats. All paces welcome; first-timers get a free lane tour.",
    author: "Columbia Track Club",
    authorNote: "Club post",
    createdAt: "Jul 28",
    replies: 4,
  },
  {
    id: "p3",
    section: "announcements",
    title: "Fleet Feet Kickstart Run Club — Wednesdays at 6",
    body: "Drop by the store Wednesday at 6 PM for a friendly 2–4 mile loop. Walkers welcome, route maps at the counter. Afterwards: store discounts for club runners.",
    author: "Fleet Feet Columbia",
    authorNote: "Store post",
    createdAt: "Jul 25",
    replies: 2,
  },
  {
    id: "p4",
    section: "community",
    title: "Best early-morning routes near campus?",
    body: "Moved to Columbia for grad school and looking for safe, well-lit 5am loops near campus. MKT trail looked great on paper — is the east section lit?",
    author: "sam_runs",
    createdAt: "Jul 30",
    replies: 3,
  },
  {
    id: "p5",
    section: "community",
    title: "Looking for a steady 10K pace buddy for Saturday long runs",
    body: "Usually run 9:00–9:30/mi for the CTC Saturday long run. Anyone want to split the pace group? Coffee at Cosmo after.",
    author: "megan.f",
    createdAt: "Jul 29",
    replies: 2,
  },
  {
    id: "p6",
    section: "community",
    title: "Shoutout: my first turkey trot crew!",
    body: "The Tuesday track crew is signing up for the Turkey Trot as a team. First 5K for two of us — open invite, all paces, costumes encouraged.",
    author: "dave.c",
    createdAt: "Jul 22",
    replies: 5,
  },
  {
    id: "p7",
    section: "qa",
    title: "How fast is Tuesday Night Track, really?",
    body: "Never done track work. I'm a 10:00/mi runner — will I be out of my depth at the CTC Tuesday session?",
    author: "first_timer",
    createdAt: "Jul 31",
    answered: true,
    replies: 3,
  },
  {
    id: "p8",
    section: "qa",
    title: "Do guests need to be members for the Saturday long run?",
    body: "The event says 'members + guests' — can I show up as a first-time guest, or do I need to join Columbia Track Club first?",
    author: "guestrunner_9",
    createdAt: "Jul 27",
    answered: true,
    replies: 2,
  },
  {
    id: "p9",
    section: "qa",
    title: "Best trail shoes for Grindstone hills?",
    body: "The Wednesday hills run is kicking my butt in road shoes. What do folks wear for the gravel and roots sections?",
    author: "hills_hater",
    createdAt: "Aug 2",
    replies: 0,
  },
];

export const CITIES: City[] = [
  {
    id: "columbia-mo",
    name: "Columbia",
    state: "MO",
    tagline: "Launch city — group runs, races, and community",
    live: true,
    groups: COLUMBIA_GROUPS,
    events: COLUMBIA_EVENTS,
    races: COLUMBIA_RACES,
    forum: COLUMBIA_FORUM,
  },
  // Future cities are data-model placeholders only — no seeded content.
  // Adding a city here (with live: true and its own groups/events/races/forum)
  // extends the app without any code changes.
  ...[
    { id: "stl-mo", name: "St. Louis", state: "MO" },
    { id: "kc-mo", name: "Kansas City", state: "MO" },
    { id: "springfield-mo", name: "Springfield", state: "MO" },
    { id: "jc-mo", name: "Jefferson City", state: "MO" },
  ].map((c) => ({
    id: c.id,
    name: c.name,
    state: c.state,
    tagline: "Coming soon",
    live: false,
    groups: [] as RunGroup[],
    events: [] as RunEvent[],
    races: [] as Race[],
    forum: [] as ForumPost[],
  })),
];
