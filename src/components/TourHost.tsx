/**
 * TourHost — the verified-runner onboarding tour.
 *
 * Mounted once inside the app shell (inside the router + AccountProvider).
 * Responsibilities:
 *  - Auto-start once for verified runners (localStorage marker) and only on
 *    normal app routes — never on auth/funnel routes (login, verify, admin…).
 *  - Route-aware steps: advancing to a step whose route differs from the
 *    current path navigates there, so each step's target is on screen.
 *  - Keyboard: Escape dismisses (marks seen), Tab is trapped inside the card,
 *    focus moves into the card on open and returns on close.
 *  - Mobile/desktop safe: full-screen dim overlay, bottom-anchored card above
 *    the bottom nav on phones, centered panel on larger screens. The target
 *    element gets a temporary brand ring while its step is active.
 *  - Reduced motion: animations are CSS-gated via `prefers-reduced-motion`.
 *  - Replay: listens for the TOUR_REPLAY_EVENT dispatched from Settings.
 *
 * TourCard is exported separately so SSR/no-jsdom tests can assert its
 * markup without the router/account/window machinery.
 */
import { useCallback, useEffect, useReducer, useRef, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAccount } from "../state/account";
import {
  INITIAL_TOUR_STATE,
  TOUR_REPLAY_EVENT,
  TOUR_STEPS,
  isTourLastStep,
  markTourSeen,
  readTourSeen,
  tourReducer,
  type TourStep,
} from "../lib/tour";
import { Icon } from "./ui";

/** Routes where the tour must never auto-start or navigate (auth funnels). */
const TOUR_STOP_ROUTES = new Set([
  "/login",
  "/signup",
  "/recovery",
  "/confirmation",
  "/callback",
  "/verify",
  "/admin",
  "/checkin",
]);

export function TourCard({
  step,
  index,
  total,
  onBack,
  onNext,
  onSkip,
}: {
  step: TourStep;
  index: number;
  total: number;
  onBack: () => void;
  onNext: () => void;
  onSkip: () => void;
}) {
  const titleId = `tour-card-title-${step.id}`;
  const isLast = isTourLastStep(index);
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={`${titleId}-body`}
      className="tour-card flex max-h-[75dvh] w-full flex-col overflow-hidden rounded-3xl bg-white shadow-2xl ring-1 ring-slate-900/10"
      data-tour-card
    >
      <div className="flex items-center justify-between gap-3 px-5 pt-4">
        <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-[#FF5741]">
          Welcome tour · {index + 1} of {total}
        </p>
        <button
          type="button"
          onClick={onSkip}
          className="min-h-9 rounded-full px-3 text-xs font-bold text-slate-500 hover:text-slate-800 active:bg-slate-100"
        >
          Skip
        </button>
      </div>
      <div className="overflow-y-auto px-5 pb-5 pt-2">
        <h2 id={titleId} className="text-lg font-black tracking-tight text-slate-900">
          {step.title}
        </h2>
        <p id={`${titleId}-body`} className="mt-1.5 text-[13.5px] leading-relaxed text-slate-600">
          {step.body}
        </p>
        <p className="mt-3 flex items-center gap-1.5 rounded-xl bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-500">
          <Icon name="pin" className="h-3.5 w-3.5 shrink-0 text-[#FF5741]" />
          {step.targetLabel}
        </p>
        {/* Step dots — screen-reader text carries the exact position. */}
        <div className="mt-4 flex items-center justify-between gap-3">
          <div className="flex gap-1.5" aria-hidden="true">
            {Array.from({ length: total }, (_, i) => (
              <span
                key={i}
                className={`h-1.5 rounded-full transition-colors ${i === index ? "w-5 bg-[#FF5741]" : "w-1.5 bg-slate-200"}`}
              />
            ))}
          </div>
          <div className="flex shrink-0 gap-2">
            {index > 0 ? (
              <button
                type="button"
                onClick={onBack}
                className="min-h-11 rounded-[10px] bg-slate-100 px-4 py-2 text-sm font-bold text-slate-700 active:bg-slate-200"
              >
                Back
              </button>
            ) : null}
            <button
              type="button"
              onClick={onNext}
              className={`min-h-11 rounded-[10px] px-5 py-2 text-sm font-bold ${
                isLast ? "bg-emerald-700 text-white active:bg-emerald-800" : "bg-[#14171C] text-white active:bg-[#252a31]"
              }`}
            >
              {isLast ? "Done" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Presentational overlay: full-screen dim + the card, bottom-anchored above
 * the bottom nav on mobile and centered on `sm:` screens. The wrapper is
 * `fixed inset-0` and blocks interaction with the app while the tour is up.
 */
export function TourOverlay({ children }: { children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-[80]" role="presentation">
      <div className="tour-overlay absolute inset-0 bg-slate-900/55 backdrop-blur-[2px]" aria-hidden="true" />
      <div className="absolute inset-x-3 bottom-24 sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-[11vh] sm:w-[26rem] sm:-translate-x-1/2">
        {children}
      </div>
    </div>
  );
}

export function TourHost() {
  const { role } = useAccount();
  const location = useLocation();
  const navigate = useNavigate();
  const [state, dispatch] = useReducer(tourReducer, INITIAL_TOUR_STATE);
  const active = state.status === "active";
  const step = TOUR_STEPS[state.step];
  const cardRef = useRef<HTMLDivElement | null>(null);
  const previousFocus = useRef<Element | null>(null);
  const highlighted = useRef<HTMLElement | null>(null);

  const stop = useCallback((kind: "dismiss" | "complete") => {
    markTourSeen(window.localStorage);
    dispatch(kind === "dismiss" ? { type: "dismiss" } : { type: "complete" });
  }, []);

  // Auto-start once for verified runners on normal app routes.
  useEffect(() => {
    if (role !== "verified" || state.status !== "idle") return;
    if (readTourSeen(window.localStorage)) return;
    if (TOUR_STOP_ROUTES.has(location.pathname)) return;
    dispatch({ type: "start" });
  }, [role, state.status, location.pathname]);

  // Settings replay.
  useEffect(() => {
    const onReplay = () => dispatch({ type: "start" });
    window.addEventListener(TOUR_REPLAY_EVENT, onReplay);
    return () => window.removeEventListener(TOUR_REPLAY_EVENT, onReplay);
  }, []);

  // Route-aware navigation: each step's target lives on `step.route`.
  useEffect(() => {
    if (!active) return;
    if (location.pathname !== step.route) navigate(step.route);
  }, [active, step.route, location.pathname, navigate]);

  // Escape dismisses (marks seen, like Skip).
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") stop("dismiss");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, stop]);

  // Target highlight + focus management.
  useEffect(() => {
    if (!active) {
      if (previousFocus.current instanceof HTMLElement) previousFocus.current.focus();
      previousFocus.current = null;
      return;
    }
    previousFocus.current = document.activeElement;
    const el = document.querySelector<HTMLElement>(step.target);
    if (el) {
      highlighted.current = el;
      el.style.outline = "3px solid #FF5741";
      el.style.outlineOffset = "3px";
      el.style.borderRadius = "12px";
    }
    const id = window.requestAnimationFrame(() => cardRef.current?.focus());
    return () => {
      window.cancelAnimationFrame(id);
      if (highlighted.current) {
        highlighted.current.style.outline = "";
        highlighted.current.style.outlineOffset = "";
        highlighted.current.style.borderRadius = "";
        highlighted.current = null;
      }
    };
  }, [active, step.id, step.target]);

  if (!active) return null;

  return (
    <TourOverlay>
      <div
        ref={cardRef}
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key !== "Tab") return;
          const focusables = cardRef.current?.querySelectorAll<HTMLElement>(
            "button, [href], [tabindex]:not([tabindex='-1'])",
          );
          if (!focusables || focusables.length === 0) return;
          const first = focusables[0];
          const last = focusables[focusables.length - 1];
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }}
        className="outline-none"
      >
        <TourCard
          step={step}
          index={state.step}
          total={TOUR_STEPS.length}
          onBack={() => dispatch({ type: "back" })}
          onNext={() => {
            if (isTourLastStep(state.step)) stop("complete");
            else dispatch({ type: "next" });
          }}
          onSkip={() => stop("dismiss")}
        />
      </div>
    </TourOverlay>
  );
}
