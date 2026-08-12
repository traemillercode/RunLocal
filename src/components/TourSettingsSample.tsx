/**
 * TourSettingsSample — a static, presentational preview of the Settings page's
 * Privacy section, rendered inside the onboarding tour's Settings step card.
 *
 * Deliberately pure: no hooks, no Router, no window/localStorage access — so
 * it is SSR-safe and unit-testable with renderToStaticMarkup (unlike the
 * VerifiedGateSheet crash pattern, this never calls useNavigate or any hook
 * unconditionally). The row labels and shown values match
 * SettingsPage's PrivacySettingsSection verbatim so the preview is honest:
 * it mirrors what the runner will actually find on /settings.
 *
 * The preview is strictly decorative: the whole mock is wrapped in an
 * `aria-hidden="true"` container with an sr-only "Preview only — not
 * interactive" note as its accessible label, and NOTHING inside is focusable
 * (no buttons, links, inputs, roles, or tabindex) — so the tab-trapping
 * TourHost and screen readers treat it as pure decoration.
 */
export const TOUR_SETTINGS_SAMPLE_CAPTION =
  "A preview of a few privacy controls — your actual settings are on this page.";

/** Exact in-app question labels from the Settings privacy section. */
const ROWS = [
  { question: "Who can find my profile", value: "Everyone" },
  { question: "My upcoming runs & races", value: "Only my connections" },
  { question: "My saved runs & races", value: "Only me" },
] as const;

export function TourSettingsSample() {
  return (
    <div className="mt-4">
      <span className="sr-only">Preview only — not interactive</span>
      <div
        aria-hidden="true"
        className="overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200"
        data-tour-settings-sample
      >
        <p className="border-b border-slate-100 px-4 py-2.5 text-[13px] font-bold text-slate-900">Privacy</p>
        <ul className="divide-y divide-slate-100">
          {ROWS.map((row) => (
            <li key={row.question} className="flex items-center justify-between gap-3 px-4 py-2.5">
              <span className="min-w-0 flex-1 text-[13px] font-medium leading-snug text-slate-700">{row.question}</span>
              <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-bold text-slate-600">
                {row.value}
              </span>
            </li>
          ))}
          <li className="flex items-center justify-between gap-3 px-4 py-2.5">
            <span className="min-w-0 flex-1 text-[13px] font-medium leading-snug text-slate-700">
              Let people find me by name
            </span>
            {/* Purely visual toggle: dark track + white knob, no role/aria/tabindex. */}
            <span className="relative inline-flex h-6 w-10 shrink-0 rounded-full bg-[#14171C]">
              <span className="absolute left-[3px] top-[3px] h-[18px] w-[18px] rounded-full bg-white shadow" />
            </span>
          </li>
        </ul>
        <p className="border-t border-slate-100 px-4 py-2.5 text-[11px] leading-relaxed text-slate-400">
          {TOUR_SETTINGS_SAMPLE_CAPTION}
        </p>
      </div>
    </div>
  );
}
