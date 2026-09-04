// Kimbio — city-first data model.
// Every entity hangs off a City. Adding a new city means adding a City entry
// and a CityData block; the UI renders whatever city is selected.

export interface City {
  id: string;
  name: string; // "Columbia"
  state: string; // "MO"
  tagline: string;
  /** True only for the seeded launch city. Future cities ship later. */
  live: boolean;
  /** Geofence center — the app enforces users be within GEOFENCE_RADIUS_MILES of this point (see src/lib/geofence.ts). Only meaningful for live cities. */
  centerLat?: number;
  centerLng?: number;
  /** Real local organizing groups & races for this city (admin-seeded). */
  groups: RunGroup[];
  events: RunEvent[];
  races: Race[];
  forum: ForumPost[];
}

export type GroupType = "rrca-chartered" | "community";

export const GROUP_TYPE_LABELS: Record<GroupType, string> = {
  "rrca-chartered": "RRCA-Chartered Club",
  community: "Community Run Group",
};

export interface RunGroup {
  id: string;
  name: string;
  /**
   * Admin-assigned label (seeded data). NEVER inferred or self-claimed —
   * a group is shown as "RRCA-Chartered Club" only when an admin has
   * assigned chartered: true in this dataset.
   */
  groupType: GroupType;
  website?: string;
}

export type InviteLabel = "Open to all" | "Members + guests" | "RSVP requested";

/**
 * How a group run treats pace — the question runners actually ask before
 * showing up ("will I get dropped?"). Deliberately a policy, not a numeric
 * range: Columbia hosts advertise "no-drop" and "all paces", never "7:45-9:00",
 * so a numeric field would sit empty. Stored as a closed set so the discovery
 * board can filter on it and the card can render one consistent badge.
 */
export const PACE_POLICIES = ["no_drop", "all_paces", "splits_by_pace", "walkers_welcome", "easy", "workout"] as const;
export type PacePolicy = (typeof PACE_POLICIES)[number];

/** Human labels — the single source of truth for form options and card badges. */
export const PACE_POLICY_LABELS: Record<PacePolicy, string> = {
  no_drop: "No-drop",
  all_paces: "All paces",
  splits_by_pace: "Splits by pace",
  walkers_welcome: "Walkers welcome",
  easy: "Easy effort",
  workout: "Workout effort",
};

export function isPacePolicy(value: unknown): value is PacePolicy {
  return typeof value === "string" && (PACE_POLICIES as readonly string[]).includes(value);
}

/**
 * Derives a policy from the legacy free-text `distanceLabel`, which asked for
 * "Distance / pace" in one box and so carries both ("3-5 mi, no-drop pace").
 * Used by the one-time backfill and as a read-time fallback for records written
 * before the field existed. Returns null when the text says nothing about pace,
 * rather than guessing a policy the host never stated.
 */
export function pacePolicyFromLabel(label: string | null | undefined): PacePolicy | null {
  const t = (label ?? "").toLowerCase();
  if (!t) return null;
  if (t.includes("no-drop") || t.includes("no drop")) return "no_drop";
  if (t.includes("splits by pace") || t.includes("split by pace")) return "splits_by_pace";
  if (t.includes("walker")) return "walkers_welcome";
  if (t.includes("all paces") || t.includes("any pace")) return "all_paces";
  if (t.includes("interval") || t.includes("tempo") || t.includes("workout") || t.includes("repeat")) return "workout";
  if (t.includes("easy") || t.includes("conversational") || t.includes("recovery")) return "easy";
  return null;
}

export interface RunEvent {
  id: string;
  groupId: string;
  title: string;
  /** 0 = Monday … 6 = Sunday — recurring weekly slot. */
  dayOfWeek: number;
  time: string; // "6:00 PM"
  location: string;
  distanceLabel: string;
  /** How the run treats pace. Null/undefined when the host stated nothing. */
  /**
   * Free text beside the enum, not instead of it. pacePolicy stays the
   * machine-readable value so filtering keeps working; this is the human one.
   */
  paceNote?: string | null;
  /**
   * When to ARRIVE, when it differs from `time`. The gap between meeting and
   * running is when newcomers introduce themselves.
   */
  meetTime?: string | null;
  pacePolicy?: PacePolicy | null;
  invite: InviteLabel;
  /** External details page (club site etc.), when the host provides one. */
  externalUrl?: string;
  /** Confirmation threshold for informal proposals — undefined/0 means no threshold, always confirmed. */
  minParticipants?: number;
  confirmedCount?: number;
  isConfirmedGroupRun?: boolean;
}

export interface Race {
  id: string;
  name: string;
  date: string; // ISO yyyy-mm-dd
  distance: string;
  location: string;
  organizer: string;
  price: string;
  registrationUrl: string;
  registrationOpen: boolean;
  registrationNote?: string;
}

export type ForumSection = "announcements" | "community" | "qa";

export const FORUM_SECTIONS: { id: ForumSection; label: string; blurb: string }[] = [
  { id: "announcements", label: "Announcements", blurb: "Official notices from clubs and organizers" },
  { id: "community", label: "Community", blurb: "Chat about routes, buddies, and local running life" },
  { id: "qa", label: "Q&A", blurb: "Questions with answers you can sort" },
];

/** Topic, independent of section — what a post is ABOUT, not what kind of post it is. */
export type ForumCategory = "training" | "races" | "gear" | "routes" | "general";
export const FORUM_CATEGORIES: { id: ForumCategory; label: string }[] = [
  { id: "training", label: "Training" },
  { id: "races", label: "Races" },
  { id: "gear", label: "Gear" },
  { id: "routes", label: "Routes" },
  { id: "general", label: "General" },
];

export type QaSort = "newest" | "unanswered" | "top";

export interface ForumPost {
  id: string;
  section: ForumSection;
  title: string;
  body: string;
  author: string;
  authorNote?: string; // e.g. "Columbia Track Club" for official announcements
  createdAt: string; // "Aug 1"
  /** True for Q&A posts that have accepted answers. */
  answered?: boolean;
  /** Announcement-level pinning. */
  pinned?: boolean;
  replies: number;
}
