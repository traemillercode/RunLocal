import { useState } from "react";
import { Link } from "react-router-dom";
import { MarketingLiveBoard } from "../components/MarketingLiveBoard";
import { CITIES } from "../data/cities";
import { Icon } from "../components/ui";
import type { IconName } from "../components/ui";
import { FEATURES, type Feature } from "../lib/features";
import { isPublicReadPath } from "../lib/geofenceBypass";

const city = CITIES.find((item) => item.id === "columbia-mo");

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
/**
 * Two supporting photos, below the fold. Cut from six: the board carries the
 * page now, and the stock set is the weakest thing on it. Dropped the fisheye
 * trail jump and the marathon crowd specifically — an action-sports image and
 * a big-race image are the visual language of every running app, which
 * contradicts a product whose whole claim is a local Tuesday evening.
 * Kept the two that read closest to a real group run.
 */
const GALLERY_MOMENTS = [
  { photo: MARKETING_IMAGES.groupSunrise, caption: "Dusty roads, early crew" },
  { photo: MARKETING_IMAGES.trailTwoRunners, caption: "Two miles in, still talking" },
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

/**
 * Explore destinations, derived rather than listed.
 *
 * Two defects this replaces:
 *   1. "Events" pointed at "/", which for a signed-out visitor IS this page —
 *      clicking it reloaded the page you were already on.
 *   2. "Forum" was offered but /forum is deliberately NOT a public read route
 *      (reading community discussion is a member benefit, not a shop window),
 *      so a guest clicking it hit the geofence and bounced back here. Groups,
 *      which IS public, was missing entirely.
 *
 * Filtering on isPublicReadPath makes the second class impossible: this menu
 * can no longer advertise a destination the geofence will refuse. If a route's
 * public status changes, the menu follows automatically instead of drifting.
 */
const EXPLORE_BLURBS: Record<string, string> = {
  "/events": "This week's group runs",
  "/groups": "Run clubs and crews near you",
  "/races": "Every local race, one place",
  "/routes": "Real routes runners actually use",
};

const EXPLORE_LINKS: { to: string; label: string; icon: IconName; blurb: string }[] = (FEATURES as readonly Feature[])
  .filter((f) => f.reach.kind === "nav" && f.nav && f.roles.includes("guest") && isPublicReadPath(f.route))
  .map((f) => ({ to: f.route, label: f.nav!.label, icon: f.nav!.icon, blurb: EXPLORE_BLURBS[f.route] ?? f.summary }));

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
        {/*
          The board IS the hero (roadmap 1.4). The full-bleed photos are gone:
          a photo says "running exists", the board says "14 runs in Columbia
          this week and 34 people are going" — only one of those is an argument.
          It also can't go stale, and our stock imagery was the weakest part of
          the page, so reducing its prominence is the point rather than a
          compromise.

          Order is headline, one subhead line, board, CTA — so on mobile the
          board lands immediately after the headline with no photo in between.
        */}
        <section className="marketing-hero-live" aria-labelledby="hero-title">
          <h1 id="hero-title">People who actually show up.</h1>
          <p className="marketing-lede-warm">Real group runs in Columbia — who's going, where, and when.</p>
          {city ? <MarketingLiveBoard city={city} /> : null}
          <div className="marketing-actions">
            <Link to="/login?mode=signup" className="marketing-button marketing-button-primary">Create your account</Link>
            <Link to="/events" className="marketing-button marketing-button-light">Browse public events <span aria-hidden="true">↗</span></Link>
          </div>
          <p className="marketing-note-warm">No login needed to look around.</p>
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
          <Link to="/sponsor">Sponsor Kimbio</Link>
          <Link to="/legal">Terms &amp; Privacy</Link>
        </span>
      </footer>
    </div>
  );
}
