import { Link, useLocation } from "react-router-dom";
import type { City } from "../types";
import { Icon } from "./ui";
import { useAccount } from "../state/account";

const items = [
  ["/", "Home", "home"], ["/races", "Races", "flag"], ["/forum", "Forum", "chat"], ["/profile", "Profile", "user"],
] as const;
export function DesktopSidebar({ city, onOpenCitySheet }: { city: City; onOpenCitySheet: () => void }) {
  const location = useLocation();
  const { me, signOut } = useAccount();
  const signedIn = me?.status === "signed_in";
  return <aside className="desktop-sidebar" aria-label="Primary navigation">
    <Link to="/" className="desktop-brand" aria-label="Run Local home"><img src="/icons/icon-192.png" alt="" /><span>Run <b>Local</b></span></Link>
    <button type="button" className="desktop-city" onClick={onOpenCitySheet} aria-label={`Change city — current: ${city.name}, ${city.state}`}><Icon name="pin" className="h-4 w-4" /><span>{city.name}, {city.state}</span><Icon name="chevronDown" className="ml-auto h-3.5 w-3.5" /></button>
    <nav className="desktop-nav" aria-label="Main"><Link to="/" className={location.pathname === "/events" || location.pathname === "/" ? "active" : ""}><Icon name="calendar" className="h-5 w-5" />Events</Link><Link to="/my-runs" className={location.pathname.startsWith("/my-runs") ? "active" : ""}><Icon name="rsvp" className="h-5 w-5" />My Runs</Link>{items.slice(1).map(([href, label, icon]) => <Link key={href} to={href} className={location.pathname.startsWith(href) ? "active" : ""}><Icon name={icon} className="h-5 w-5" />{label}</Link>)}</nav>
    <div className="desktop-account">{signedIn ? <>
      <Link to="/profile"><Icon name="user" className="h-5 w-5" />Profile</Link>
      <Link to="/settings"><Icon name="settings" className="h-5 w-5" />Settings</Link>
      <button type="button" className="desktop-account-action" onClick={() => void signOut()}><Icon name="logout" className="h-5 w-5" />Sign out</button>
    </> : <Link to="/login"><Icon name="settings" className="h-5 w-5" />Log in</Link>}</div>
  </aside>;
}
