/**
 * ProfileCompletionBanner — the "add a photo and bio" prompt.
 *
 * Rendered on the same city content pages as HomeCityBanner, for SIGNED-IN
 * accounts missing a profile photo or a bio. Both are required for a
 * complete profile (per owner decision — not optional), so this stays
 * visible, on every content page, until both are set. Routes to /settings,
 * where ProfileDetailsSection and ProfilePhotoSettings persist the values.
 */
import { useNavigate } from "react-router-dom";
import { useAccount } from "../state/account";
import { Icon } from "./ui";

export function ProfileCompletionBanner() {
  const navigate = useNavigate();
  const { me } = useAccount();
  if (me?.status !== "signed_in") return null;
  const missingPhoto = !me.account.profilePhotoUrl;
  const missingBio = !me.account.bio;
  if (!missingPhoto && !missingBio) return null;
  const what = missingPhoto && missingBio ? "a profile photo and a bio" : missingPhoto ? "a profile photo" : "a bio";
  return (
    <section className="mt-4 rounded-2xl bg-amber-50 p-4 ring-1 ring-amber-200">
      <p className="flex items-start gap-2 text-[13px] font-semibold leading-relaxed text-amber-900">
        <Icon name="user" className="mt-0.5 h-4 w-4 shrink-0" />
        Add {what} — required so other runners know who they're connecting with.
      </p>
      <button
        type="button"
        onClick={() => navigate("/settings")}
        className="mt-2.5 inline-flex min-h-11 items-center justify-center rounded-[10px] bg-[#14171C] px-5 text-[13px] font-bold text-white active:bg-[#252a31]"
      >
        Complete my profile
      </button>
    </section>
  );
}
