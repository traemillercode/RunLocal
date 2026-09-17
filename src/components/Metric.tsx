import type { ReactNode } from "react";

/**
 * The quiet label, the loud value.
 *
 * THE STRONGEST DEVICE IN THE PRODUCT, and it was private to DepartureBoard
 * while 43 other files hand-rolled the uppercase-tracked label — 110 uses. Most
 * of those are section headings rather than metrics, which is the distinction
 * worth keeping: a Metric is a label ABOVE A VALUE. A heading is just a label.
 *
 * It reads as designed because it is a considered choice about this content —
 * a run's pace and distance are facts you scan, so the fact is loud and its
 * name is quiet. That is specificity rather than style, which is the only
 * reliable way out of the templated look.
 *
 * TABULAR NUMERALS are not decoration here. A column of paces or distances
 * where the digits do not align reads as sloppy at a glance, and every value
 * this renders is a number or a short measurement.
 */

type Size = "default" | "display";

export function Metric({
  label,
  value,
  suffix,
  size = "default",
  inverted = false,
  className = "",
}: {
  label: string;
  value: ReactNode;
  /** A unit or qualifier, kept quiet so the value stays the loud part. */
  suffix?: string;
  /**
   * `display` for the case where the number IS the answer to why someone opened
   * the screen — a lifetime count, a confirmation. One per screen at most; two
   * display metrics side by side compete and neither wins.
   */
  size?: Size;
  /** On ink surfaces the label and value both need lifting. */
  inverted?: boolean;
  className?: string;
}) {
  const muted = inverted ? "rgba(255,255,255,0.55)" : "#7A7A72";
  const valueColor = inverted ? "#FFFFFF" : "#14171C";
  return (
    <div className={`flex flex-col gap-0.5 ${className}`}>
      <span
        className="font-bold uppercase"
        style={{ fontSize: "var(--text-meta)", letterSpacing: "0.12em", color: muted }}
      >
        {label}
      </span>
      <span
        className="font-extrabold tabular-nums"
        style={{
          fontSize: size === "display" ? "var(--text-display)" : "var(--text-subhead)",
          letterSpacing: size === "display" ? "-0.03em" : "-0.015em",
          color: valueColor,
          lineHeight: size === "display" ? 1.05 : undefined,
        }}
      >
        {value}
        {suffix ? (
          <span
            className="ml-1.5 align-middle font-bold"
            style={{ fontSize: "var(--text-body)", color: muted }}
          >
            {suffix}
          </span>
        ) : null}
      </span>
    </div>
  );
}
