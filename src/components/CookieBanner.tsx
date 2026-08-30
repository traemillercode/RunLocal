/**
 * Cookie/analytics consent banner. Shows once per browser (until a choice is
 * made), gates UTM capture on the actual choice - see lib/analytics.ts for
 * what "accept" and "decline" really do.
 */
import { useEffect, useState } from "react";
import { getConsent, setConsent } from "../lib/analytics";
import { initTelemetry, shutdownTelemetry } from "../lib/telemetry";

export function CookieBanner() {
  const [detail, setDetail] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setVisible(getConsent() === null);
  }, []);

  if (!visible) return null;

  const choose = (value: "granted" | "declined") => {
    setConsent(value);
    // Consent now actually starts and stops collection, rather than only
    // gating UTM capture. Declining tears down anything already running so
    // the choice takes effect immediately, not at the next reload.
    if (value === "granted") void initTelemetry();
    else shutdownTelemetry();
    setVisible(false);
  };

  return (
    /*
     * INK, not white.
     *
     * This was a near-white overlay pinned at z-60 across the bottom of every page — and
     * it is what five rounds of "white band" reports were actually seeing.
     * html, body, the footer and the padding were all fixed correctly and the
     * symptom never moved, because we kept painting the page while an overlay
     * painted over it.
     *
     * It is also the last surface that had not been through the brand system,
     * and it sits on the one page a stranger is being advertised to. Coral is
     * on Accept only: it is the single primary action here, and Decline must
     * stay equally easy to find, which is why it is a visible outline rather
     * than a quieter shade of the background.
     */
    <div className="fixed inset-x-0 bottom-0 z-[60] border-t border-white/10 bg-[#14161A]/97 p-4 shadow-[0_-4px_24px_rgba(0,0,0,0.4)] backdrop-blur sm:p-5">
      <div className="mx-auto flex max-w-3xl flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
        {/*
          Two lines by default, with the detail behind an expander.

          NOT a copy change — every word below is the original, and the
          disclosure of session replay stays in the summary line rather than
          being hidden, because burying the surprising part is exactly what an
          expander must not do. What moves is the enumeration.

          The reason is proportion: at 390px the five-line version took roughly
          a third of the first fold, sitting over the board that is the whole
          argument for signing up. A third of a first impression is too much to
          spend on consent, and a consent notice nobody reads because it is
          overwhelming is not more honest than one they do.
        */}
        <div className="min-w-0">
          <p className="text-[13px] leading-relaxed text-[#B5B7BB]">
            During the beta we record how the app is used, including an anonymized replay of your session, so we can fix what&apos;s broken.{" "}
            <button
              type="button"
              onClick={() => setDetail((d) => !d)}
              aria-expanded={detail}
              className="font-bold text-[#F7F7F5] underline underline-offset-2"
            >
              {detail ? "Less" : "What we collect"}
            </button>
          </p>
          {detail ? (
            <p className="mt-2 text-[13px] leading-relaxed text-[#B5B7BB]">
              Which pages you visit, errors you hit, and an anonymized replay of your session. Typing is never recorded. Decline and nothing is collected at all.
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 gap-2">
          <button type="button" onClick={() => choose("declined")} className="h-11 rounded-full border border-white/25 px-4 text-[13px] font-bold text-[#F7F7F5] active:bg-white/10">
            Decline
          </button>
          <button type="button" onClick={() => choose("granted")} className="h-11 rounded-full bg-[#FF5741] px-4 text-[13px] font-bold text-[#14171C] active:opacity-90">
            Accept
          </button>
        </div>
      </div>
    </div>
  );
}
