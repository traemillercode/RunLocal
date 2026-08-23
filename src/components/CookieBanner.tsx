/**
 * Cookie/analytics consent banner. Shows once per browser (until a choice is
 * made), gates UTM capture on the actual choice - see lib/analytics.ts for
 * what "accept" and "decline" really do.
 */
import { useEffect, useState } from "react";
import { getConsent, setConsent } from "../lib/analytics";

export function CookieBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setVisible(getConsent() === null);
  }, []);

  if (!visible) return null;

  const choose = (value: "granted" | "declined") => {
    setConsent(value);
    setVisible(false);
  };

  return (
    <div className="fixed inset-x-0 bottom-0 z-[60] border-t border-slate-200 bg-white/97 p-4 shadow-[0_-4px_16px_rgba(0,0,0,0.06)] backdrop-blur sm:p-5">
      <div className="mx-auto flex max-w-3xl flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[13px] leading-relaxed text-slate-600">
          We use cookies to understand how people find Kimbio (like which ad or link brought you here). Decline and nothing is tracked.
        </p>
        <div className="flex shrink-0 gap-2">
          <button type="button" onClick={() => choose("declined")} className="h-10 rounded-full bg-slate-100 px-4 text-[13px] font-bold text-slate-700 active:bg-slate-200">
            Decline
          </button>
          <button type="button" onClick={() => choose("granted")} className="h-10 rounded-full bg-[#14171C] px-4 text-[13px] font-bold text-white active:opacity-90">
            Accept
          </button>
        </div>
      </div>
    </div>
  );
}
