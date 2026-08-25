import { useState } from "react";
import { Link } from "react-router-dom";
import { CITIES } from "../data/cities";
import { Icon } from "../components/ui";

const city = CITIES.find((item) => item.id === "columbia-mo");
const previewEvents = city?.events.slice(0, 3) ?? [];

/** Real photography, stored locally and optimized (see public/marketing/). Sourced as general running lifestyle imagery — not verified to depict the specific named Missouri trails, so captions never make that claim. */
export const MARKETING_IMAGES = {
  hero: "/marketing/hero-marathon-crowd.jpg",
  trailMisty: "/marketing/trail-misty-forest.jpg",
  trailTwoRunners: "/marketing/trail-two-runners.jpg",
  track: "/marketing/track-sunny-field.jpg",
  groupSunrise: "/marketing/group-run-dusty-sunrise.jpg",
  groupSunset: "/marketing/group-run-riverside-sunset.jpg",
  raceLegs: "/marketing/race-legs-closeup.jpg",
  silhouetteDusk: "/marketing/silhouette-dusk-run.jpg",
  trailJump: "/marketing/trail-jump-fisheye.jpg",
  trackRelay: "/marketing/track-relay-start.jpg",
};

/** The "moments" gallery — captions read like what a runner would actually caption their own photo, not marketing copy. */
const GALLERY_MOMENTS = [
  { photo: MARKETING_IMAGES.groupSunrise, caption: "Dusty roads, early crew" },
  { photo: MARKETING_IMAGES.trailTwoRunners, caption: "Two miles in, still talking" },
  { photo: MARKETING_IMAGES.groupSunset, caption: "Last light on the river path" },
  { photo: MARKETING_IMAGES.trailJump, caption: "Trail day, no regrets" },
  { photo: MARKETING_IMAGES.trackRelay, caption: "Handoff practice, Tuesday nights" },
  { photo: MARKETING_IMAGES.silhouetteDusk, caption: "One more mile before dark" },
];

const sections = [
  { eyebrow: "Find your people", title: "Groups that feel local", body: "Real clubs and community run groups already moving in Columbia — no fake crowds, no empty listings, just who's actually out there." },
  { eyebrow: "Plan the big day", title: "Races, without the rabbit holes", body: "Every local race in one place — dates, distances, and a straight link to sign up. No more ten open tabs." },
  { eyebrow: "Stay in the loop", title: "A better local running conversation", body: "Ask a gear question, find a pace group, post a route — a running forum without the spam, because everyone here is a real, verified runner." },
];

/** Columbia, MO trail classics for the showcase. Distance/elevation are real published figures for these trails; there's no GPX-backed route detail page yet, so no fabricated elevation graphic is shown here - that's the next real piece to build. */
const FEATURED_ROUTES = [
  { name: "MKT Nature Trail", surface: "Gravel", distance: "8.9 mi", elevation: "120 ft", photo: MARKETING_IMAGES.trailTwoRunners },
  { name: "Rock Bridge — Devil's Icebox", surface: "Trail", distance: "3.9 mi", elevation: "310 ft", photo: MARKETING_IMAGES.trailJump },
  { name: "Grindstone Loop", surface: "Trail", distance: "8.1 mi", elevation: "480 ft", photo: MARKETING_IMAGES.track },
];

const EXPLORE_LINKS = [
  { to: "/", label: "Events", icon: "calendar", blurb: "This week's group runs" },
  { to: "/races", label: "Races", icon: "trophy", blurb: "Every local race, one place" },
  { to: "/forum", label: "Forum", icon: "chat", blurb: "Ask, share, find a pace group" },
  { to: "/routes", label: "Routes", icon: "mapPin", blurb: "Real GPX-backed trails" },
];

function MarketingNav() {
  const [exploreOpen, setExploreOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className="marketing-header">
      <a href="#top" className="marketing-logo" aria-label="Kimbio home"><span>KIM</span>BIO</a>

      {/* Desktop: a real dropdown with actual destinations, not just an anchor-scroll link. */}
      <nav aria-label="Marketing navigation" className="marketing-nav marketing-nav-desktop">
        <div className="marketing-nav-dropdown-wrap" onMouseEnter={() => setExploreOpen(true)} onMouseLeave={() => setExploreOpen(false)}>
          <button type="button" className="marketing-nav-dropdown-trigger" aria-expanded={exploreOpen} aria-haspopup="true">
            Explore <Icon name="chevronDown" className="h-3.5 w-3.5" />
          </button>
          {exploreOpen ? (
            <div className="marketing-nav-dropdown">
              {EXPLORE_LINKS.map((l) => (
                <Link key={l.to} to={l.to} className="marketing-nav-dropdown-item">
                  <span className="marketing-nav-dropdown-icon"><Icon name={l.icon} className="h-4.5 w-4.5" /></span>
                  <span>
                    <span className="marketing-nav-dropdown-label">{l.label}</span>
                    <span className="marketing-nav-dropdown-blurb">{l.blurb}</span>
                  </span>
                </Link>
              ))}
            </div>
          ) : null}
        </div>
        <a href="#how-it-works">How it works</a>
        <Link to="/login" className="marketing-nav-loglink">Log in</Link>
        <Link to="/login?mode=signup" className="marketing-nav-cta">Sign up</Link>
      </nav>

      {/* Mobile: previously nothing rendered here at all except Sign up - a real hamburger with real destinations instead. */}
      <button
        type="button"
        className="marketing-nav-hamburger"
        aria-label="Open menu"
        aria-expanded={mobileOpen}
        onClick={() => setMobileOpen(true)}
      >
        <Icon name="menu" className="h-5 w-5" />
      </button>

      {mobileOpen ? (
        <div className="marketing-mobile-menu" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="marketing-mobile-menu-header">
            <span className="marketing-logo"><span>KIM</span>BIO</span>
            <button type="button" aria-label="Close menu" onClick={() => setMobileOpen(false)} className="marketing-mobile-menu-close">
              <Icon name="close" className="h-5 w-5" />
            </button>
          </div>
          <p className="marketing-mobile-menu-kicker">Explore</p>
          {EXPLORE_LINKS.map((l) => (
            <Link key={l.to} to={l.to} className="marketing-mobile-menu-item" onClick={() => setMobileOpen(false)}>
              <Icon name={l.icon} className="h-5 w-5" /> {l.label}
            </Link>
          ))}
          <a href="#how-it-works" className="marketing-mobile-menu-item" onClick={() => setMobileOpen(false)}>
            <Icon name="spark" className="h-5 w-5" /> How it works
          </a>
          <div className="marketing-mobile-menu-actions">
            <Link to="/login" onClick={() => setMobileOpen(false)} className="marketing-button marketing-button-light">Log in</Link>
            <Link to="/login?mode=signup" onClick={() => setMobileOpen(false)} className="marketing-button marketing-button-primary">Sign up</Link>
          </div>
        </div>
      ) : null}
    </header>
  );
}

export function MarketingPage() {
  return (
    <div className="marketing-page">
      <MarketingNav />
      <main id="top">
        <section className="marketing-hero-v2" aria-labelledby="hero-title">
          <div className="marketing-hero-v2-photo marketing-hero-v2-photo-left">
            <img src={MARKETING_IMAGES.trailTwoRunners} alt="" loading="eager" />
          </div>
          <div className="marketing-hero-v2-photo marketing-hero-v2-photo-right">
            <img src={MARKETING_IMAGES.groupSunset} alt="" loading="eager" />
          </div>
          <div className="marketing-hero-v2-card">
            <p className="marketing-kicker-warm">Columbia, MO · Live now</p>
            <h1 id="hero-title">People who actually show up.</h1>
            <p className="marketing-lede-warm">Real group runs, real faces, real Columbia. No fake crowds, no empty listings.</p>
            <div className="marketing-actions"><Link to="/events" className="marketing-button marketing-button-primary">Browse public events <span aria-hidden="true">↗</span></Link><Link to="/login?mode=signup" className="marketing-button marketing-button-light">Create your account</Link></div>
            <p className="marketing-note-warm">No login needed to look around.</p>
          </div>
        </section>

        <section className="marketing-gallery" aria-labelledby="gallery-title">
          <p className="marketing-kicker-warm">From the community</p>
          <h2 id="gallery-title">This is who you'd be running with.</h2>
          <div className="marketing-gallery-grid">
            {GALLERY_MOMENTS.map((m) => (
              <figure className="marketing-gallery-item" key={m.photo}>
                <img src={m.photo} alt="" loading="lazy" />
                <figcaption>{m.caption}</figcaption>
              </figure>
            ))}
          </div>
        </section>

        <section id="preview" className="marketing-section marketing-preview" aria-labelledby="preview-title">
          <p className="marketing-kicker">This week</p><h2 id="preview-title">What’s happening in Columbia</h2>
          <p className="marketing-muted">Public event listings from the launch city.</p>
          <div className="marketing-event-grid">{previewEvents.map((event) => <article className="marketing-event" key={event.id}><div className="marketing-event-mark" aria-hidden="true">↗</div><h3>{event.title}</h3><p>{event.time}</p><p>{event.location}</p><span>{event.distanceLabel}</span></article>)}</div>
          <Link to="/events" className="marketing-text-link">See all public events <span aria-hidden="true">→</span></Link>
        </section>

        <section className="marketing-route-section" aria-labelledby="routes-title">
          <p className="marketing-kicker">Columbia classics</p>
          <h2 id="routes-title">Routes people actually run</h2>
          <div className="marketing-route-grid">
            {FEATURED_ROUTES.map((route) => (
              <article className="marketing-route-card" key={route.name}>
                <div className="marketing-route-photo" style={{ backgroundImage: `url(${route.photo})` }}>
                  <span className="marketing-route-badge">{route.surface}</span>
                </div>
                <div className="marketing-route-body">
                  <h3>{route.name}</h3>
                  <div className="marketing-route-stats">
                    <span><strong>{route.distance}</strong>distance</span>
                    <span><strong>{route.elevation}</strong>elevation gain</span>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section id="how-it-works" className="marketing-section marketing-feature-section" aria-labelledby="features-title">
          <p className="marketing-kicker">The local layer</p>
          <h2 id="features-title">More than a start line</h2>
          <div className="marketing-feature-grid">
            {sections.map((section) => (
              <article className="marketing-feature" key={section.title}>
                <p className="marketing-kicker">{section.eyebrow}</p>
                <h3>{section.title}</h3>
                <p>{section.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="marketing-split-section" aria-labelledby="tools-title">
          <div>
            <p className="marketing-kicker">Log it your way</p>
            <h2 id="tools-title">Every run,<br />on your terms.</h2>
            <p>No auto-sync, no algorithm deciding what counts. Log your distance, pace, and surface — add a photo, a voice note, or tag who you ran with. Intentional, not automatic.</p>
          </div>
          <div className="marketing-split-photo">
            <img src={MARKETING_IMAGES.raceLegs} alt="" loading="lazy" />
          </div>
        </section>

        <section className="marketing-split-section marketing-split-reverse" aria-labelledby="group-title">
          <div>
            <p className="marketing-kicker">Better with people</p>
            <h2 id="group-title">Running alone<br />is optional.</h2>
            <p>Find a group that actually shows up — real people, real verification, running the same streets and trails you already know.</p>
          </div>
          <div className="marketing-split-photo">
            <img src={MARKETING_IMAGES.trailMisty} alt="" loading="lazy" />
          </div>
        </section>

        <section className="marketing-trust" aria-labelledby="trust-title">
          <p className="marketing-kicker">Built with care</p>
          <h2 id="trust-title">Useful, not noisy.</h2>
          <p>Your runs stay yours — private by default, with real identity verification behind every profile. No feeds to game, no fake followers, no features that quietly turn on without telling you.</p>
          <div className="marketing-trust-tags"><span>Private by default</span><span>City-scoped</span><span>Human-reviewed</span></div>
        </section>
        <section className="marketing-multicity" aria-labelledby="cities-title">
          <p className="marketing-kicker">Starting in Columbia</p>
          <h2 id="cities-title">More cities,<br /><em>same local feeling.</em></h2>
          <p>Columbia is live. We're building the foundation to bring Kimbio to more running communities next.</p>
        </section>
        <section className="marketing-final" aria-labelledby="final-title">
          <h2 id="final-title">Make your next run<br /><em>a local one.</em></h2>
          <Link to="/login?mode=signup" className="marketing-button marketing-button-primary">Join Kimbio <span aria-hidden="true">↗</span></Link>
        </section>
      </main>
      <footer className="marketing-footer">
        <span>KIMBIO</span>
        <span>Columbia, MO · Launch city</span>
        <span className="marketing-footer-links">
          <a href="https://facebook.com/getkimbio" target="_blank" rel="noopener noreferrer" aria-label="Kimbio on Facebook">Facebook</a>
          <a href="https://instagram.com/getkimbio" target="_blank" rel="noopener noreferrer" aria-label="Kimbio on Instagram">Instagram</a>
          <Link to="/legal">Terms &amp; Privacy</Link>
        </span>
      </footer>
    </div>
  );
}
