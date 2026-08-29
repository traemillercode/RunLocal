/**
 * Verified badge — the ONLY verification artifact the public UI may show.
 * Deliberately tiny and content-free: no dates, no phone, no IPs, no history.
 */
import { Icon } from "./ui";

export function VerifiedBadge({ size = "md" }: { size?: "sm" | "md" }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-[10px] bg-[#FF5741] font-bold text-[#14171C] ${
        size === "sm" ? "px-1.5 py-0.5 text-[11px]" : "px-2.5 py-1 text-[11px]"
      }`}
      title="Identity verified by Kimbio"
    >
      <Icon name="shield" className={size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5"} />
      Verified
    </span>
  );
}
