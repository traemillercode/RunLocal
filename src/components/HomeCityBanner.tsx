/**
 * HomeCityBanner — the "choose your home city" prompt.
 *
 * Rendered on the city content pages for SIGNED-IN accounts that have no home
 * city yet (legacy accounts created before home-city selection existed). It
 * makes the unset state impossible to miss and routes to /settings, where the
 * selection persists to the account (server-validated). Guests never see it —
 * they own the guest city switcher by design.
 */
import { useNavigate } from "react-router-dom";
import { useAccount } from "../state/account";
import { useSelectedCity } from "../state/city";
import { Icon } from "./ui";

export function HomeCityBanner() {
  const navigate = useNavigate();
  const { me } = useAccount();
  const { hasHomeCity } = useSelectedCity();
  if (me?.status !== "signed_in" || hasHomeCity) return null;
  return (
    <section className="mt-4 rounded-2xl bg-amber-50 p-4 ring-1 ring-amber-200">
      <p className="flex items-start gap-2 text-[13px] font-semibold leading-relaxed text-amber-900">
        <Icon name="pin" className="mt-0.5 h-4 w-4 shrink-0" />
        Choose your home city — your runs, races, and forum default to it.
      </p>
      <button
        type="button"
        onClick={() => navigate("/settings")}
        className="mt-2.5 inline-flex min-h-11 items-center justify-center rounded-full bg-[#14171C] px-5 text-[13px] font-bold text-white active:bg-[#20262E]"
      >
        Choose home city
      </button>
    </section>
  );
}
