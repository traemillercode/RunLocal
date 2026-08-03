/**
 * Top-right account menu (avatar / profile navigation).
 *
 * Renders the entries from `profileMenuEntries` — guest: Sign up / Log in;
 * pending: verification progress + read-only state; verified: badge; owner:
 * Admin control center. Every row is a 44px touch target. The owner flag comes
 * from the server's `/api/me` payload — nothing here inspects emails or roles.
 *
 * The menu opens as a top-anchored popup under the header avatar (not a bottom
 * sheet): it closes on outside click / Escape and is sized to stay inside the
 * viewport on mobile, clear of the fixed bottom navigation.
 *
 * `AccountMenuContent` is the pure presentational body (no hooks) so UI tests
 * can render the real guest menu markup with react-dom/server.
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { profileMenuEntries, type MenuEntry } from "../lib/accountMenu";
import { phaseLabel, roleLabel } from "../lib/accounts";
import type { Me } from "../lib/accounts";
import { useAccount } from "../state/account";
import { Icon, Popover } from "./ui";

export function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? "")
      .join("") || "R"
  );
}

/** Presentational menu body — driven by props so tests can render it without a router. */
export function AccountMenuContent({
  me,
  backendAvailable,
  onNavigate,
  onLogout,
}: {
  me: Me | null;
  backendAvailable: boolean;
  onNavigate: (to: string) => void;
  onLogout: () => void;
}) {
  const account = me?.status === "signed_in" ? me.account : null;
  const photo = account?.profilePhotoUrl ?? null;

  const handleEntry = (entry: MenuEntry) => {
    if (entry.key === "logout") onLogout();
    else if (entry.to) onNavigate(entry.to);
  };

  return (
    <>
      {!backendAvailable ? (
        <p className="mb-3 rounded-xl bg-amber-50 p-3 text-[12px] leading-relaxed text-amber-900">
          The Run Local server is unreachable right now — signing in and verification are unavailable until it's back.
        </p>
      ) : null}

      {account ? (
        <div className="mb-3 flex items-center gap-3 rounded-2xl bg-slate-50 p-3">
          {photo ? (
            <img src={photo} alt="" className="h-11 w-11 rounded-full object-cover" />
          ) : (
            <span className="grid h-11 w-11 place-items-center rounded-full bg-[#0b2b22] text-sm font-extrabold text-[#c8f169]">
              {initials(account.name)}
            </span>
          )}
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-slate-900">{account.name}</p>
            <p className="truncate text-xs text-slate-500">
              {account.status === "verified" ? (
                <>
                  <span className="font-semibold text-emerald-700">Verified</span> · {roleLabel(account.role)}
                </>
              ) : (
                <>
                  <span className="font-semibold text-amber-700">Pending</span> · {phaseLabel(account.phase)}
                </>
              )}
              {account.isOwner ? " · Super Admin" : ""}
            </p>
          </div>
        </div>
      ) : null}

      {account && account.status === "pending" ? (
        <p className="mb-3 rounded-xl bg-amber-50 p-3 text-[12px] leading-relaxed text-amber-900">
          <span className="font-semibold">Read-only account.</span> No RSVPs, posts, or submissions until your
          email + selfie verification is approved.
        </p>
      ) : null}

      <ul className="divide-y divide-slate-100">
        {profileMenuEntries(me).entries.map((entry) => (
          <li key={entry.key}>
            <button
              type="button"
              onClick={() => handleEntry(entry)}
              className={`flex min-h-11 w-full items-center gap-3 px-1 py-3 text-left ${
                entry.danger ? "text-red-600" : "text-slate-800"
              } active:bg-slate-50`}
            >
              <span
                className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${
                  entry.danger ? "bg-red-50 text-red-600" : "bg-slate-100 text-slate-600"
                }`}
              >
                <Icon name={entry.icon} className="h-4.5 w-4.5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] font-semibold">{entry.label}</span>
                {entry.hint ? <span className="block truncate text-xs text-slate-500">{entry.hint}</span> : null}
              </span>
              {entry.danger ? null : <Icon name="chevronRight" className="h-4 w-4 shrink-0 text-slate-300" />}
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

export function AccountMenuButton() {
  const [open, setOpen] = useState(false);
  const { me, backendAvailable, signOut } = useAccount();
  const navigate = useNavigate();
  const account = me?.status === "signed_in" ? me.account : null;
  const photo = account?.profilePhotoUrl ?? null;
  const verified = account?.status === "verified";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={account ? `Account menu — signed in as ${account.name}` : "Account menu — sign up or log in"}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white/10 text-white ring-1 ring-white/25 active:bg-white/20"
      >
        {photo ? (
          <img src={photo} alt="" className="h-10 w-10 rounded-full object-cover" />
        ) : (
          <span className="relative grid h-10 w-10 place-items-center rounded-full text-[13px] font-extrabold">
            {account ? initials(account.name) : <Icon name="users" className="h-5 w-5" />}
            {account && !verified ? (
              <span className="absolute -bottom-0.5 -right-0.5 grid h-4 w-4 place-items-center rounded-full bg-amber-400 ring-2 ring-[#0b2b22]">
                <Icon name="clock" className="h-2.5 w-2.5 text-[#0b2b22]" />
              </span>
            ) : null}
            {account && verified ? (
              <span className="absolute -bottom-0.5 -right-0.5 grid h-4 w-4 place-items-center rounded-full bg-[#c8f169] ring-2 ring-[#0b2b22]">
                <Icon name="check" className="h-2.5 w-2.5 text-[#0b2b22]" />
              </span>
            ) : null}
          </span>
        )}
      </button>

      <Popover
        open={open}
        onClose={() => setOpen(false)}
        title={account ? "Account" : "Run Local account"}
        align="right"
      >
        <AccountMenuContent
          me={me}
          backendAvailable={backendAvailable}
          onNavigate={(to) => {
            setOpen(false);
            navigate(to);
          }}
          onLogout={() => {
            setOpen(false);
            void signOut();
            navigate("/");
          }}
        />
      </Popover>
    </>
  );
}
