import { Link, useLocation } from "react-router-dom";
import type { City } from "../types";
import { Icon } from "./ui";
import { useAccount } from "../state/account";

const items = [
  ["/", "Home", "home"], ["/races", "Races", "flag"], ["/forum", "Forum", "chat"], ["/profile", "Profile", "user"],
] as const;
export function DesktopSidebar({ city, onOpenCitySheet }: { city: City; onOpenCitySheet: () => void }) {
  const location = useLocation();
  const { me } = useAccount();
  return <aside className="desktop-sidebar" aria-label="Primary navigation">
    <Link to="/" className="desktop-brand" aria-label="Run Local home"><img src="/icons/icon-192.png" alt="" /><span>Run <b>Local</b></span></Link>
    <button type="button" className="desktop-city" onClick={onOpenCitySheet} aria-label={`Change city — current: ${city.name}, ${city.state}`}><Icon name="pin" className="h-4 w-4" /><span>{city.name}, {city.state}</span><Icon name="chevronDown" className="ml-auto h-3.5 w-3.5" /></button>
    <nav className="desktop-nav" aria-label="Main"><Link to="/" className={location.pathname === "/events" || location.pathname === "/" ? "active" : ""}><Icon name="calendar" className="h-5 w-5" />Events</Link>{items.slice(1).map(([href, label, icon]) => <Link key={href} to={href} className={location.pathname.startsWith(href) ? "active" : ""}><Icon name={icon} className="h-5 w-5" />{label}</Link>)}</nav>
    <div className="desktop-account"><Link to={me?.status === "signed_in" ? "/settings" : "/login"}><Icon name="settings" className="h-5 w-5" />{me?.status === "signed_in" ? "Account & settings" : "Log in"}</Link></div>
  </aside>;
}
