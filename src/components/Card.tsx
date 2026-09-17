import type { ReactNode } from "react";

/**
 * The card.
 *
 * AUDITED FIRST, per the Sheet and Metric lessons — and this one genuinely did
 * not exist as a shared primitive. What exists is RailCard, which is a
 * STRUCTURED sidebar card (kicker, title, footer) and far too opinionated for
 * 52 generic surfaces.
 *
 * MEASURED: the recipe is `rounded-2xl bg-white p-5 shadow-sm ring-1
 * ring-slate-200/70`, 52 exact matches, and every near-miss differs only in
 * padding — p-5 (40), p-4 (9), p-6 (3) — or drops the ring opacity.
 *
 * So this is not chaos, it is a system with one name missing. Same shape as the
 * type scale: a consistent choice made repeatedly by hand, which drifts the
 * moment someone eyeballs a fourth padding.
 *
 * THE THREE DENSITIES ARE THE POINT, not an accident to be normalised away. The
 * template look uses one padding everywhere; real interfaces have rhythm — a
 * metric group is tight, a card is generous, a section break is airy. The
 * measured distribution already encodes that, so it is named rather than
 * flattened.
 */

type Density = "compact" | "default" | "generous";

const PADDING: Record<Density, string> = {
  /* Dense rows and list items — 9 uses. */
  compact: "p-4",
  /* The workhorse — 40 uses. */
  default: "p-5",
  /* A card that is the only thing on its screen — 3 uses. */
  generous: "p-6",
};

export function Card({
  density = "default",
  as: Tag = "div",
  className = "",
  children,
  ...rest
}: {
  density?: Density;
  /**
   * `section` or `li` where the card IS the semantic element. A div wrapping a
   * section is the kind of nesting that makes a page unreadable to a screen
   * reader without changing anything visible.
   */
  as?: "div" | "section" | "li" | "article";
  className?: string;
  children: ReactNode;
} & Omit<React.HTMLAttributes<HTMLElement>, "className" | "children">) {
  return (
    <Tag
      className={[
        "rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/70",
        PADDING[density],
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...rest}
    >
      {children}
    </Tag>
  );
}
