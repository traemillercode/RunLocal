import type { ButtonHTMLAttributes, ReactNode } from "react";

/**
 * The one button.
 *
 * 311 <button> tags with no shared component, each inventing its own padding,
 * radius, disabled and loading treatment. The inventory that shaped this API:
 *
 *   VISUAL     147 ghost, 95 dark fill, 29 coral, 28 outlined, 12 destructive.
 *   SIZE       145 at h-11, 148 with NO HEIGHT AT ALL, 12 at h-9.
 *   LOADING    82 express one, with seven different in-flight labels.
 *   ICON-ONLY  34, all with aria-label.
 *   ONE-OFFS   196 distinct className strings; 168 used exactly once — 85%.
 *
 * THAT LAST NUMBER IS WHY `className` IS PART OF THE API RATHER THAN A LEAK.
 * A component trying to absorb 196 strings needs a prop per page. This one owns
 * the four things that are genuinely shared — variant, size, disabled, loading
 * — and gets out of the way for the rest.
 */

type Variant = "primary" | "secondary" | "ghost" | "destructive";
type Size = "default" | "compact";

/*
 * Two sizes, and only two, because nothing else earned a name: h-11 (145 uses,
 * the touch standard) and h-9 (12). The 148 buttons with no height are not a
 * third size — they are a touch-target gap, and they get h-11 by adopting this.
 */
const SIZES: Record<Size, string> = {
  default: "h-11 px-4 text-[13px]",
  compact: "h-9 px-3 text-[12px]",
};

const VARIANTS: Record<Variant, string> = {
  /* The single most important action on a screen. Coral on ink. */
  primary: "bg-[#FF5741] text-[#14171C] hover:bg-[#e94735] active:bg-[#e94735]",
  /* The considered action beside it — dark fill, the largest filled group. */
  secondary: "bg-[#14171C] text-white hover:opacity-90 active:opacity-90",
  /* Tertiary and menu actions. Correctly ghost — but see the sweep note. */
  ghost: "text-slate-700 hover:bg-slate-100 active:bg-slate-200",
  /* Removal and revocation. Outline rather than fill: a destructive action
     should be findable without being the loudest thing on the screen. */
  destructive: "text-rose-700 ring-1 ring-rose-300 hover:bg-rose-50",
};

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  variant?: Variant;
  size?: Size;
  /**
   * Owns the ELLIPSIS, never the verb. "Saving…" and "Sending…" carry
   * meaningful information; the ellipsis convention does not. Seven different
   * in-flight labels across the app is correct — one implementation, seven
   * labels — so the caller passes the word and this adds the rest.
   */
  loading?: boolean;
  /** Shown in place of children while loading. Without it, children stay put. */
  loadingLabel?: string;
  className?: string;
} & (
    | {
        /**
         * ICON-ONLY REQUIRES A NAME, enforced by the type rather than by a lint
         * rule or a review. Correct by construction, the same property as
         * getMyRuns taking no account id — you cannot get it wrong rather than
         * being reminded not to.
         */
        iconOnly: true;
        "aria-label": string;
        children: ReactNode;
      }
    | { iconOnly?: false; children: ReactNode }
  );

export function Button({
  variant = "secondary",
  size = "default",
  loading = false,
  loadingLabel,
  iconOnly = false,
  className = "",
  disabled,
  children,
  ...rest
}: Props) {
  return (
    <button
      /*
       * type="button" BY DEFAULT, which fixes 16 latent submits for free.
       *
       * The asymmetry is the reason: a forgotten type="submit" fails LOUDLY and
       * IMMEDIATELY — click submit, nothing happens, found in seconds. A
       * forgotten type="button" fails SILENTLY and MUCH LATER, when someone
       * wraps it in a form months from now and every click reloads the page.
       *
       * A guard asserts no <form> contains a Button without an explicit type.
       */
      type="button"
      {...rest}
      /* Loading disables too: a second click on an in-flight action is the
         double-submit that produced three "You're verified" emails. */
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={[
        "inline-flex shrink-0 items-center justify-center gap-2 rounded-[10px] font-bold",
        "transition-colors disabled:opacity-40 disabled:pointer-events-none",
        /* A visible focus ring on EVERY variant. Ghost is the largest group at
           147 and has no fill, so without this the keyboard user cannot see
           where they are on nearly half the controls in the product. */
        "outline-none focus-visible:ring-2 focus-visible:ring-[#14171C] focus-visible:ring-offset-2",
        iconOnly ? (size === "compact" ? "h-9 w-9 px-0" : "h-11 w-11 px-0") : SIZES[size],
        VARIANTS[variant],
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {loading && loadingLabel ? `${loadingLabel}\u2026` : children}
    </button>
  );
}
