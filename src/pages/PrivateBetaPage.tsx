import { useState } from "react";
import { Link } from "react-router-dom";
import * as api from "../lib/api";

/**
 * What a signed-out stranger sees when they reach any app route during the
 * closed beta.
 *
 * NOT a geofence wall and not an error. Those two were the previous outcomes:
 * the wall says "you're in the wrong place", which is wrong and slightly
 * insulting to someone who followed a link, and an error says something broke
 * when nothing did. Neither tells the truth, which is simply that the door is
 * shut for now.
 *
 * There is deliberately no sign-in link and no signup form. During the beta
 * both advertise a door that will not open — the same dead-affordance pattern
 * removed from the board, the pending RSVP button, and My Clubs. /login stays
 * reachable by direct URL for invite links and for the owner.
 */
export function PrivateBetaPage() {
  return (
    <div className="marketing-page min-h-screen">
      <div className="mx-auto max-w-xl px-6 py-20 text-left">
        <p className="text-[11px] font-bold uppercase tracking-widest text-[#FF5741]">Columbia, MO</p>
        <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-[#F7F7F5] sm:text-4xl">
          Kimbio is in a private beta.
        </h1>
        <p className="mt-3 text-[15px] leading-relaxed text-[#B5B7BB]">
          We&apos;re running with a small group in Columbia while we get things right.
          It won&apos;t be long.
        </p>
        {/*
          A real form, not a mailto. A mailto loses everyone who is not on a
          configured mail client, records nothing, and leaves the next fifty
          users sitting in an inbox with no list and no way to invite them as a
          batch.
        */}
        <WaitlistForm />
        <p className="mt-6 text-[13px] text-[#8A8D93]">
          <Link to="/" className="underline underline-offset-2">Back to the homepage</Link>
        </p>
      </div>
    </div>
  );
}


function WaitlistForm() {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!email.trim()) return;
    setBusy(true);
    setError(null);
    const r = await api.joinWaitlist({ email: email.trim(), name: name.trim() || undefined });
    setBusy(false);
    if (r.ok) setDone(true);
    else setError(r.error.message);
  };

  if (done) {
    /*
     * The same message whether they were already on the list or not. Telling
     * someone "you already signed up" is a correction nobody needs, and it
     * leaks that an address is on the list to anyone who guesses it.
     */
    return (
      <div className="mt-6 rounded-xl bg-[#1A1E24] p-4 ring-1 ring-white/10">
        <p className="text-[15px] font-bold text-[#F7F7F5]">You&apos;re on the list.</p>
        <p className="mt-1 text-[13px] text-[#B5B7BB]">
          We&apos;ll email you the moment we open up. Check your spam folder if nothing arrives — we&apos;re a new domain.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-6 max-w-sm">
      <label className="block text-[13px] font-bold text-[#B5B7BB]" htmlFor="wl-email">Email</label>
      <input
        id="wl-email"
        type="email"
        inputMode="email"
        autoComplete="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@example.com"
        className="mt-1 h-11 w-full rounded-xl border border-white/15 bg-[#1A1E24] px-3.5 text-[15px] text-[#F7F7F5] outline-none focus:border-[#FF5741]"
      />
      {/* Optional, and labelled as such — a required name on a waitlist is a
          reason not to bother. */}
      <label className="mt-3 block text-[13px] font-bold text-[#B5B7BB]" htmlFor="wl-name">Name <span className="font-normal text-[#8A8D93]">(optional)</span></label>
      <input
        id="wl-name"
        type="text"
        autoComplete="name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="mt-1 h-11 w-full rounded-xl border border-white/15 bg-[#1A1E24] px-3.5 text-[15px] text-[#F7F7F5] outline-none focus:border-[#FF5741]"
      />
      {error ? <p className="mt-2 text-[13px] font-semibold text-[#FF8B7A]">{error}</p> : null}
      <button
        type="button"
        onClick={() => void submit()}
        disabled={busy || !email.trim()}
        className="mt-4 h-11 w-full rounded-xl bg-[#FF5741] text-[14px] font-bold text-[#14171C] disabled:opacity-40"
      >
        {busy ? "Adding you…" : "Tell me when it opens"}
      </button>
    </div>
  );
}
