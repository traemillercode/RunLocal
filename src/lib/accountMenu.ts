/**
 * Account/profile menu model — pure logic, unit-tested without a DOM.
 *
 * The header's top-right avatar menu renders exactly what this function
 * returns. It is driven by the server-issued `Me` payload: guests see
 * Sign up / Log in, pending users see their verification progress (and the
 * read-only note), verified users see their badge, and the owner sees the
 * Admin / Super Admin entry. The `isOwner` flag is server-computed — this
 * module never inspects emails or self-assigns roles.
 */
import type { Me } from "./accounts";
import { phaseLabel, roleLabel } from "./accounts";
import { CITIES } from "../data/cities";

export interface MenuEntry {
  key: string;
  label: string;
  icon: string;
  hint?: string;
  /** Internal route to navigate to. */
  to?: string;
  /** Distinguishes destructive entries (rendered red). */
  danger?: boolean;
}

/**
 * Menu entries for the given auth state.
 * - guest / unknown  → Sign up, Log in
 * - pending          → verification status (progress + read-only), Settings, Log out
 * - verified         → verified status, Settings, Log out
 * - owner            → everything above plus the Admin control center entry
 */
export function profileMenuEntries(me: Me | null): { entries: MenuEntry[]; signedInLabel: string } {
  if (!me || me.status !== "signed_in") {
    return {
      signedInLabel: "",
      entries: [
        { key: "signup", label: "Sign up", icon: "plus", to: "/login?mode=signup" },
        { key: "login", label: "Log in", icon: "chevronRight", to: "/login" },
      ],
    };
  }
  const account = me.account;
  const verified = account.status === "verified";
  const rejected = account.status === "rejected";
  const statusLabel = verified
    ? `Verified · ${roleLabel(account.role)}`
    : rejected
      ? "Denied · Verification not approved"
      : `Pending · ${phaseLabel(account.phase)}`;
  const entries: MenuEntry[] = [
    {
      key: "status",
      label: verified ? "My verification status" : rejected ? "Verification status" : "Verification & account status",
      icon: verified ? "shield" : rejected ? "close" : "clock",
      hint: statusLabel,
      to: "/verify",
    },
    { key: "settings", label: "Settings", icon: "sort", to: "/settings" },
    { key: "connections", label: "Connections", icon: "users", to: "/connections" },
  ];
  if (account.isOwner) {
    entries.push({
      key: "admin",
      label: "Admin control center",
      icon: "lock",
      hint: "Super Admin",
      to: "/admin",
    });
  }
  if (account.role === "city_admin" && account.adminCityId) {
    const cityName = CITIES.find((c) => c.id === account.adminCityId)?.name ?? account.adminCityId;
    entries.push({
      key: "city-admin",
      label: "City admin",
      icon: "shield",
      hint: cityName,
      to: "/admin",
    });
  }
  entries.push({ key: "logout", label: "Log out", icon: "close", danger: true });
  return { signedInLabel: account.name, entries };
}

/** Is this account pending verification (read-only)? */
export function isPendingAccount(me: Me | null): boolean {
  return Boolean(me && me.status === "signed_in" && me.account.status === "pending");
}
