/**
 * Trusted Member badge — the manual trust / blue-check artifact.
 *
 * Deliberately distinct from the identity `VerifiedBadge` (coral shield):
 * this badge means a Global or City Admin explicitly marked the member as
 * known/trusted in their local community (audited, reason-required, never
 * self-granted). It is content-free on purpose — no dates, no city, no
 * history; the audit log holds the details.
 */
import { Icon } from "./ui";

export function TrustedBadge({ size = "md" }: { size?: "sm" | "md" }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-[10px] bg-sky-500 font-bold text-white ${
        size === "sm" ? "px-1.5 py-0.5 text-[11px]" : "px-2.5 py-1 text-[11px]"
      }`}
      title="Trusted member — verified by Kimbio leadership"
    >
      <Icon name="check" className={size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5"} />
      Trusted
    </span>
  );
}
