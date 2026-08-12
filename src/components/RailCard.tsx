/**
 * Shared rail primitives — the ONE card/stack for every desktop side rail
 * (Events home rail, Forum rail, Event detail rail, Races rail).
 *
 * Consistent behavior across all four rails:
 *  - rails are HIDDEN below the lg (1024px) breakpoint — no more unstyled
 *    flush sections on mobile;
 *  - cards use the standard card utilities (rounded-2xl ring-slate-200/70
 *    bg-white shadow-sm) with p-4 on small screens and p-5 at lg+;
 *  - the compact cross-link item pattern (bold title + muted meta line) is
 *    extracted here so every rail links consistently.
 */
import type { ReactNode } from "react";
import { Link } from "react-router-dom";

/** Rail container — desktop-only column of cards. */
export function RailStack({ ariaLabel, children }: { ariaLabel: string; children: ReactNode }) {
  return (
    <aside aria-label={ariaLabel} className="hidden lg:block">
      <div className="sticky top-8 grid gap-4 self-start">{children}</div>
    </aside>
  );
}

/** One rail card. */
export function RailCard({
  kicker,
  title,
  children,
  footer,
}: {
  kicker?: string;
  title?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/70 lg:p-5">
      {kicker ? <p className="text-[11px] font-extrabold uppercase tracking-[.12em] text-[#FF5741]">{kicker}</p> : null}
      {title ? <h2 className="mt-1 text-lg font-extrabold tracking-tight text-slate-900">{title}</h2> : null}
      {children}
      {footer}
    </section>
  );
}

/** Compact cross-link row — bold title + muted meta line (former .desktop-rail-item). */
export function RailItemLink({ to, title, meta }: { to: string; title: ReactNode; meta?: ReactNode }) {
  return (
    <Link to={to} className="mt-3 block border-t border-slate-100 pt-2.5">
      <b className="block text-[13px] font-bold text-slate-800">{title}</b>
      {meta ? <span className="mt-0.5 block text-xs text-slate-500">{meta}</span> : null}
    </Link>
  );
}

/** "See all →" footer link for a rail card. */
export function RailSeeAll({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="mt-3 inline-flex items-center text-xs font-extrabold text-[#14171C]">
      {children}
    </Link>
  );
}
