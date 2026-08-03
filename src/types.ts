// Run Local — city-first data model.
// Every entity hangs off a City. Adding a new city means adding a City entry
// and a CityData block; the UI renders whatever city is selected.

export interface City {
  id: string;
  name: string; // "Columbia"
  state: string; // "MO"
  tagline: string;
  /** True only for the seeded launch city. Future cities ship later. */
  live: boolean;
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

export interface RunEvent {
  id: string;
  groupId: string;
  title: string;
  /** 0 = Monday … 6 = Sunday — recurring weekly slot. */
  dayOfWeek: number;
  time: string; // "6:00 PM"
  location: string;
  distanceLabel: string;
  invite: InviteLabel;
  /** External details page (club site etc.), when the host provides one. */
  externalUrl?: string;
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
