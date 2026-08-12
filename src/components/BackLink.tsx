import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Icon } from "./ui";

/**
 * Standard in-page back affordance — a STABLE route link, never
 * history-dependent (no navigate(-1)), so the destination is predictable.
 */
export function BackLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="mb-3 inline-flex items-center gap-1 text-[13px] font-semibold text-slate-500">
      <Icon name="chevronRight" className="h-4 w-4 rotate-180" /> {children}
    </Link>
  );
}
