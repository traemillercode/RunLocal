import { useState } from "react";
import * as api from "../lib/api";
import { AVATAR_STYLES, avatarInitials } from "../lib/avatars";

/**
 * Pick a photo or an avatar, shown when the first RSVP is refused.
 *
 * THE REQUIREMENT IS A CHOICE, NOT AN UPLOAD. An avatar-less attendee list is
 * impersonal in a product whose whole point is knowing who is going — but
 * requiring a photograph would push people toward lying or leaving, and on a
 * product that publishes where you will be at dawn, "not my face" is a
 * reasonable position rather than an edge case.
 *
 * Shown at the FIRST RSVP rather than at signup: signup is friction at the
 * worst moment, before anyone has seen the product. The first RSVP is when it
 * starts to matter, because that is when your name appears on a list other
 * people read while deciding whether to come.
 */
export function AvatarPicker({
  name,
  onChosen,
  onClose,
}: {
  name: string;
  /** Called after a successful choice, so the caller can retry what was blocked. */
  onChosen: () => void;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    const r = await api.setAvatarStyle(selected);
    setBusy(false);
    if (!r.ok) { setError(r.error.message); return; }
    onChosen();
  };

  /* Falls back to a neutral mark rather than "?" — a question mark reads as an
     error state in a grid of choices. */
  const initials = name.trim() ? avatarInitials(name) : "\u2022";

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div className="w-full max-w-md rounded-t-2xl bg-white p-5 pb-8 sm:rounded-2xl sm:pb-5" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-extrabold text-slate-900">Pick how you show up</h2>
        {/*
          States the reason rather than the rule. "Required before RSVP" is a
          policy; "other runners see this when deciding whether to come" is why
          it exists, and it is also true.
        */}
        <p className="mt-1 text-[13px] leading-relaxed text-slate-600">
          Your name goes on the list for this run. Other runners see it when they&apos;re deciding whether to
          come — a face makes that list feel like people rather than names.
        </p>

        <div className="mt-4 grid grid-cols-4 gap-3">
          {AVATAR_STYLES.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setSelected(s.id)}
              aria-label={s.label}
              aria-pressed={selected === s.id}
              className={`grid aspect-square place-items-center rounded-full text-[16px] font-extrabold ${
                selected === s.id ? "ring-2 ring-[#14171C] ring-offset-2" : ""
              }`}
              style={{ background: s.bg, color: s.fg }}
            >
              {initials}
            </button>
          ))}
        </div>

        {error ? <p className="mt-3 text-[13px] font-semibold text-rose-600">{error}</p> : null}

        <button
          type="button"
          onClick={() => void save()}
          disabled={!selected || busy}
          className="mt-4 h-11 w-full rounded-xl bg-[#FF5741] text-[14px] font-bold text-[#14171C] disabled:opacity-40"
        >
          {busy ? "Saving…" : "Use this"}
        </button>
        {/*
          A photo is the other half of the same choice, not a better version of
          it — so it is a peer link rather than a primary action above the
          avatars.
        */}
        <a
          href="/settings"
          className="mt-2 grid h-11 w-full place-items-center rounded-xl text-[14px] font-bold text-slate-700 ring-1 ring-slate-300"
        >
          Upload a photo instead
        </a>
      </div>
    </div>
  );
}
