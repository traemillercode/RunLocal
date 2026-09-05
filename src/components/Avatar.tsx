import { avatarStyleFor, avatarInitials } from "../lib/avatars";

/**
 * A person's face, everywhere.
 *
 * SEVEN PLACES hand-rolled this — ConnectionsPage, MessagesPage, ProfilePage,
 * RunnerProfilePage, AccountMenu, ActivityCards, Tagging — each with its own
 * initials helper, its own sizes, and its own fallback colour.
 *
 * And none of them knew about `avatarStyle`. So someone who picked an avatar
 * rather than uploading a photo saw it in the picker and nowhere else: their
 * chosen presentation existed in the database and never reached a single
 * surface. That is the same "capability with no path to it" shape as the purge
 * endpoints, one layer down.
 *
 * One component means the face follows the person. Change it once and it
 * changes on the roster, the thread list, the attendee sheet and the profile —
 * which is what makes an avatar an identity rather than a decoration.
 */

type Size = "xs" | "sm" | "md" | "lg";

/* Sizes sit inside the measured type scale — 11px is the readability floor and
   16px the top of the scale. My first version used 10px and 20px, and the
   accessibility and token guards caught both. */
const PX: Record<Size, string> = {
  xs: "h-6 w-6 text-[11px]",
  sm: "h-8 w-8 text-[11px]",
  md: "h-10 w-10 text-[13px]",
  lg: "h-16 w-16 text-[16px]",
};

export function Avatar({
  name,
  photoUrl,
  avatarStyle,
  size = "md",
  className = "",
}: {
  name: string;
  /** A real photo wins when there is one. */
  photoUrl?: string | null;
  /** The chosen default, for people who did not want their face public. */
  avatarStyle?: string | null;
  size?: Size;
  className?: string;
}) {
  const base = `${PX[size]} shrink-0 rounded-full object-cover`;

  if (photoUrl) {
    return <img src={photoUrl} alt="" className={`${base} ${className}`} />;
  }

  /*
   * The chosen avatar, or the first style as a fallback. Never a blank circle:
   * an avatarless row on an attendee list is the impersonal thing the
   * requirement exists to prevent, and a missing style should degrade to a
   * face rather than to nothing.
   */
  const style = avatarStyleFor(avatarStyle);
  return (
    <span
      aria-hidden="true"
      className={`${base} grid place-items-center font-extrabold ${className}`}
      style={{ background: style.bg, color: style.fg }}
    >
      {avatarInitials(name)}
    </span>
  );
}
