import { useState } from "react";
import type { AppStore } from "../lib/store";
import { useToast } from "../lib/toast";
import { Icon, PillButton, Sheet } from "./ui";

interface SignInSheetProps {
  open: boolean;
  onClose: () => void;
  store: AppStore;
  /** Context shown above the form, e.g. why sign-in is required. */
  reason: string;
}

/**
 * MVP sign-in affordance. There is no real auth backend in this build:
 * we collect an email/phone for launch notifications only and never claim
 * that SMS verification, selfies, or live accounts exist yet.
 */
export function SignInSheet({ open, onClose, store, reason }: SignInSheetProps) {
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(!!store.state.notifiedEmail);

  const submit = () => {
    const trimmed = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(trimmed)) {
      setError("Enter a valid email so we can reach you.");
      return;
    }
    store.setNotifiedEmail(trimmed);
    setError(null);
    setDone(true);
    toast("You're on the list — we'll email you when verification launches.", "success");
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={done ? "You're on the list" : "Sign in to Run Local"}
      subtitle={done ? undefined : "Verification & accounts launch in a later phase."}
    >
      {done ? (
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <span className="grid h-14 w-14 place-items-center rounded-full bg-emerald-100 text-emerald-700">
            <Icon name="check" className="h-7 w-7" />
          </span>
          <p className="text-sm leading-relaxed text-slate-600">
            Thanks! We'll email <span className="font-semibold text-slate-900">{store.state.notifiedEmail}</span> when
            sign-in and verification go live. Until then you can keep browsing as a guest.
          </p>
          <PillButton variant="primary" onClick={onClose} className="mt-2 w-full">
            Done
          </PillButton>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="flex items-start gap-2 rounded-xl bg-amber-50 p-3.5 text-[13px] leading-relaxed text-amber-900">
            <Icon name="lock" className="mt-0.5 h-4 w-4 shrink-0" />
            {reason}
          </p>
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold text-slate-700">Email</span>
            <input
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-12 w-full rounded-xl border border-slate-300 bg-white px-4 text-[16px] text-slate-900 outline-none placeholder:text-slate-400 focus:border-[#0b2b22] focus:ring-2 focus:ring-[#c8f169]/60"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold text-slate-700">
              Phone <span className="font-normal text-slate-400">(optional — for verification when it launches)</span>
            </span>
            <input
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="(573) 555-0123"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="h-12 w-full rounded-xl border border-slate-300 bg-white px-4 text-[16px] text-slate-900 outline-none placeholder:text-slate-400 focus:border-[#0b2b22] focus:ring-2 focus:ring-[#c8f169]/60"
            />
          </label>
          {error ? <p className="text-sm font-medium text-red-600">{error}</p> : null}
          <PillButton variant="secondary" onClick={submit} className="w-full">
            <Icon name="mail" className="h-4 w-4" /> Notify me when verification launches
          </PillButton>
          <p className="text-center text-xs leading-relaxed text-slate-400">
            This is a preview build — no account is created and nothing is verified.
          </p>
        </div>
      )}
    </Sheet>
  );
}
