import { useState } from "react";
import { SignInSheet } from "../components/SignInSheet";
import { Chip, Icon, PillButton, Sheet } from "../components/ui";
import type { AppStore } from "../lib/store";
import { useToast } from "../lib/toast";
import type { City } from "../types";

export function ProfilePage({ city, store }: { city: City; store: AppStore }) {
  const toast = useToast();
  const [signInOpen, setSignInOpen] = useState(false);
  const [futureOpen, setFutureOpen] = useState(false);
  const [notificationsOn, setNotificationsOn] = useState(false);

  const rsvps = city.events.filter((e) => store.state.rsvped[e.id]);
  const verified = store.isVerified;

  return (
    <div className="mx-auto w-full max-w-md px-4 pb-32 pt-4">
      <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">Profile</h1>
      <p className="mt-0.5 text-sm font-medium text-slate-500">Runner profile & settings</p>

      {/* Identity card */}
      <section className="mt-4 overflow-hidden rounded-2xl bg-[#0b2b22] text-white shadow-sm">
        <div className="flex items-center gap-4 p-5">
          <span className="grid h-16 w-16 shrink-0 place-items-center rounded-full bg-[#c8f169] text-xl font-extrabold text-[#0b2b22]">
            {verified ? "DR" : "G"}
          </span>
          <div className="min-w-0">
            <p className="text-lg font-bold leading-tight">{verified ? "Demo Runner" : "Guest runner"}</p>
            <p className="mt-0.5 text-[13px] text-white/70">{city.name}, {city.state}</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {verified ? (
                <Chip tone="volt">
                  <Icon name="shield" className="h-3 w-3" /> Verified runner
                </Chip>
              ) : (
                <Chip tone="outline">
                  <Icon name="users" className="h-3 w-3" /> Guest
                </Chip>
              )}
              {verified ? (
                <Chip tone="outline">
                  <Icon name="spark" className="h-3 w-3" /> Demo preview
                </Chip>
              ) : null}
            </div>
          </div>
        </div>
        {verified ? (
          <div className="border-t border-white/10 bg-white/5 px-5 py-3">
            <p className="flex items-start gap-2 text-[12px] leading-relaxed text-white/70">
              <Icon name="spark" className="mt-0.5 h-4 w-4 shrink-0 text-[#c8f169]" />
              Demo preview — not a real account. Real verification (phone/SMS) launches in a later phase.
            </p>
          </div>
        ) : null}
      </section>

      {/* Guest CTA */}
      {!verified ? (
        <section className="mt-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70">
          <h2 className="text-[15px] font-bold text-slate-900">Create your runner profile</h2>
          <p className="mt-1 text-[13px] leading-relaxed text-slate-600">
            Verified runners get RSVPs, a public profile, and posting access. Verification (phone/SMS) launches in a later
            phase — we'll notify you when it's live.
          </p>
          <PillButton variant="secondary" onClick={() => setSignInOpen(true)} className="mt-3.5 w-full">
            <Icon name="shield" className="h-4 w-4" /> Sign in & get notified
          </PillButton>
        </section>
      ) : null}

      {/* Demo verified preview toggle */}
      <section className="mt-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-[15px] font-bold text-slate-900">Preview the verified experience</h2>
            <p className="mt-0.5 text-[13px] text-slate-500">Explore the app as a verified runner (demo only).</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={verified}
            onClick={() => {
              if (verified) {
                store.exitDemoVerified();
                toast("Demo mode off — back to guest.", "neutral");
              } else {
                store.enterDemoVerified();
                toast("Demo mode on — this is a preview, not a real account.", "info");
              }
            }}
            className={`relative h-8 w-14 shrink-0 rounded-full transition-colors ${verified ? "bg-[#0b2b22]" : "bg-slate-300"}`}
            aria-label="Toggle verified runner demo preview"
          >
            <span
              className={`absolute top-1 h-6 w-6 rounded-full bg-white shadow transition-all ${verified ? "left-7" : "left-1"}`}
            />
          </button>
        </div>
      </section>

      {/* Verified content (demo) */}
      {verified ? (
        <section className="mt-4 space-y-3">
          <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70">
            <h2 className="text-[15px] font-bold text-slate-900">Upcoming RSVPs</h2>
            {rsvps.length === 0 ? (
              <p className="mt-2 text-[13px] text-slate-500">
                No RSVPs yet. Tap <span className="font-semibold">RSVP</span> on a group run to see it here.
              </p>
            ) : (
              <ul className="mt-3 space-y-2">
                {rsvps.map((e) => (
                  <li key={e.id} className="flex items-center justify-between gap-3 rounded-xl bg-emerald-50 px-3.5 py-2.5">
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-semibold text-slate-800">{e.title}</span>
                      <span className="block text-xs text-slate-500">{e.location}</span>
                    </span>
                    <Chip tone="emerald">
                      <Icon name="check" className="h-3 w-3" /> In
                    </Chip>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70">
            <h2 className="text-[15px] font-bold text-slate-900">My groups</h2>
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {city.groups.slice(0, 3).map((g) => (
                <Chip key={g.id} tone="outline">
                  {g.name}
                </Chip>
              ))}
              <Chip tone="neutral">+ 2 more</Chip>
            </div>
            <p className="mt-2.5 text-[11px] text-slate-400">Sample — group membership joins launch later.</p>
          </div>
        </section>
      ) : null}

      {/* Settings */}
      <section className="mt-4 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/70">
        <h2 className="border-b border-slate-100 px-5 py-3.5 text-[15px] font-bold text-slate-900">Settings</h2>
        <ul className="divide-y divide-slate-100">
          <li className="flex items-center justify-between gap-3 px-5 py-3.5">
            <span className="text-[14px] font-medium text-slate-700">City</span>
            <span className="text-[14px] text-slate-500">
              {city.name}, {city.state}
            </span>
          </li>
          <li>
            <button
              type="button"
              onClick={() => setNotificationsOn((v) => !v)}
              className="flex w-full items-center justify-between gap-3 px-5 py-3.5 text-left active:bg-slate-50"
            >
              <span className="text-[14px] font-medium text-slate-700">Reminders & notifications</span>
              <span
                className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${notificationsOn ? "bg-[#0b2b22]" : "bg-slate-300"}`}
              >
                <span
                  className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${notificationsOn ? "left-6" : "left-1"}`}
                />
              </span>
            </button>
            {notificationsOn ? (
              <p className="px-5 pb-3 text-[11px] text-slate-400">Nice try — notifications ship in a later phase. 😉</p>
            ) : null}
          </li>
          <li>
            <button
              type="button"
              onClick={() => setFutureOpen(true)}
              className="flex w-full items-center justify-between gap-3 px-5 py-3.5 text-left active:bg-slate-50"
            >
              <span className="text-[14px] font-medium text-slate-700">Verified badge preview</span>
              <Icon name="chevronRight" className="h-5 w-5 text-slate-300" />
            </button>
          </li>
          <li className="px-5 py-3.5">
            <p className="text-[11px] leading-relaxed text-slate-400">
              Run Local MVP preview — sample seed data, no real accounts. Verification, hosting, and submissions arrive in
              later phases.
            </p>
          </li>
        </ul>
      </section>

      <Sheet open={futureOpen} onClose={() => setFutureOpen(false)} title="Verified runner badge" subtitle="What's coming">
        <div className="space-y-3 pb-2">
          <p className="flex items-start gap-2 rounded-xl bg-slate-50 p-3.5 text-[13px] leading-relaxed text-slate-600">
            <Icon name="shield" className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
            In a later phase, runners verify with a phone number so community members know who's who. The badge shown in
            demo mode is a preview of that — it is <span className="font-semibold">not</span> a real verification.
          </p>
          <p className="text-xs leading-relaxed text-slate-500">
            What a verified profile will include: your name, city, home group, RSVP history, and forum posting. No selfies,
            no public training data — just proof you're a real local runner.
          </p>
          <PillButton
            variant="secondary"
            className="w-full"
            onClick={() => {
              setFutureOpen(false);
              setSignInOpen(true);
            }}
          >
            <Icon name="mail" className="h-4 w-4" /> Notify me when it launches
          </PillButton>
        </div>
      </Sheet>

      <SignInSheet
        open={signInOpen}
        onClose={() => setSignInOpen(false)}
        store={store}
        reason="Runner profiles & verification launch in a later phase — add your email and we'll notify you. Nothing is verified in this preview."
      />
    </div>
  );
}
