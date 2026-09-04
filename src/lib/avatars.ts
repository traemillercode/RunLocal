/**
 * Default avatars — a chosen presentation, not a photograph.
 *
 * An avatar-less attendee list is impersonal in a product whose whole point is
 * knowing who is going. But REQUIRING a photograph would push people toward
 * either lying or leaving, and a running app publishes where you will be at
 * dawn — "I do not want my face on that list" is a reasonable position, not an
 * edge case.
 *
 * So the requirement is a CHOICE: upload a photo, or pick one of these. A real
 * account underneath, whatever face you want on top — the same position the
 * safety architecture takes on display names.
 *
 * Generated rather than illustrated: no asset pipeline, no licensing, every
 * combination is distinct at a glance, and adding one is a line rather than a
 * file.
 */

export interface AvatarStyle {
  id: string;
  label: string;
  /** Background. */
  bg: string;
  /** Initials and marks. */
  fg: string;
}

/*
 * Ordered so the first few are the brand and the rest are clearly different
 * from each other at a glance — the point of a set is telling people apart on
 * a roster, which a gradient of near-identical blues would not do.
 */
export const AVATAR_STYLES: readonly AvatarStyle[] = [
  { id: "coral", label: "Coral", bg: "#FF5741", fg: "#14171C" },
  { id: "ink", label: "Ink", bg: "#14171C", fg: "#F7F7F5" },
  { id: "moss", label: "Moss", bg: "#2F5D50", fg: "#F7F7F5" },
  { id: "clay", label: "Clay", bg: "#C2703D", fg: "#14171C" },
  { id: "sky", label: "Sky", bg: "#2E5E8C", fg: "#F7F7F5" },
  { id: "plum", label: "Plum", bg: "#6B3F6E", fg: "#F7F7F5" },
  { id: "sand", label: "Sand", bg: "#D8C7A1", fg: "#14171C" },
  { id: "slate", label: "Slate", bg: "#4A5259", fg: "#F7F7F5" },
];

export const DEFAULT_AVATAR_STYLE = AVATAR_STYLES[0];

/** Look up a style, falling back rather than rendering nothing. */
export function avatarStyleFor(id: string | null | undefined): AvatarStyle {
  return AVATAR_STYLES.find((s) => s.id === id) ?? DEFAULT_AVATAR_STYLE;
}

/** Up to two letters. Matches the existing initials fallback everywhere else. */
export function avatarInitials(name: string): string {
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? "")
      .join("") || "?"
  );
}
