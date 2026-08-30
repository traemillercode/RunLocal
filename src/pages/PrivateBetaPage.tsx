import { Link } from "react-router-dom";

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
          A mailto rather than a form: hello@ receives now, and a form here
          would need a table, an endpoint and moderation to hold addresses we
          have not yet decided what to do with.
        */}
        <a
          href="mailto:hello@getkimbio.com?subject=Kimbio%20beta"
          className="mt-6 inline-flex h-11 items-center rounded-xl bg-[#FF5741] px-5 text-[14px] font-bold text-[#14171C]"
        >
          Email us for a spot
        </a>
        <p className="mt-6 text-[13px] text-[#8A8D93]">
          <Link to="/" className="underline underline-offset-2">Back to the homepage</Link>
        </p>
      </div>
    </div>
  );
}
