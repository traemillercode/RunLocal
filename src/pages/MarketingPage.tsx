import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import * as api from "../lib/api";
import { BuildStamp } from "../components/BuildStamp";
import { MarketingLiveBoard } from "../components/MarketingLiveBoard";
import { CITIES } from "../data/cities";
import { Icon } from "../components/ui";
import type { IconName } from "../components/ui";
import { FEATURES, type Feature } from "../lib/features";


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

/*
 * SECOND CAUSE of the broken dropdown, and the one a click fix alone would have
 * hidden: this filtered on isPublicReadPath, which the closed beta reduced to
 * nothing. So the menu rendered zero items even when it opened.
 *
 * The filter was right when the public set described where a guest could GO.
 * It no longer does — every destination now leads to the private-beta page,
 * which is a legitimate place to send someone and explains the situation. The
 * menu should show what Kimbio HAS; the pages themselves say what is open.
 *
 * Still derived from the registry, so a new guest-facing feature appears
 * automatically. Only the reachability filter is dropped.
 */
const EXPLORE_LINKS: { to: string; label: string; icon: IconName; blurb: string }[] = (FEATURES as readonly Feature[])
  .filter((f) => f.reach.kind === "nav" && f.nav && f.roles.includes("guest") && EXPLORE_BLURBS[f.route] !== undefined)
  .map((f) => ({ to: f.route, label: f.nav!.label, icon: f.nav!.icon, blurb: EXPLORE_BLURBS[f.route]! }));

/**
 * Is signup open? Driven by the server so the page follows the CMS the moment
 * the city is flipped to invite_only — no build flag, nothing to redeploy.
 * Defaults to open while loading: briefly showing a CTA that disappears beats
 * briefly telling an invited person the door is shut.
 */
function useSignupOpen(): boolean | null {
  /*
   * null while loading, and the page renders NEITHER state until it resolves.
   *
   * Both defaults are wrong. Defaulting open flashes "Create your account" at a
   * stranger who cannot have one — on an ad-driven page, that is the worst
   * possible half-second. Defaulting closed flashes "private beta" at everyone
   * once the beta opens. Rendering nothing costs one frame of a slightly
   * shorter hero and tells nobody anything untrue.
   */
  const [open, setOpen] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    void api.getSignupStatus("columbia-mo").then((r) => {
      if (alive) setOpen(r.ok ? r.data.open : false);
    });
    return () => { alive = false; };
  }, []);
  return open;
}

function MarketingNav() {
  const signupOpen = useSignupOpen();
  const [exploreOpen, setExploreOpen] = useState(false);
  const exploreRef = useRef<HTMLDivElement | null>(null);
  /*
   * Close on an outside click or Escape — the two ways anyone expects to
   * dismiss a menu, and both required once hover no longer closes it.
   */
  useEffect(() => {
    if (!exploreOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!exploreRef.current?.contains(e.target as Node)) setExploreOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setExploreOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [exploreOpen]);
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="marketing-header-sticky">
      <header className="marketing-header">
      {/* Icon + wordmark as one lockup. The mark exists (public/favicon.svg — the
            coral tile with the two-stroke glyph) and appeared on no page, which
            made the most recognisable brand asset absent from the product. */}
        <a href="#top" className="marketing-logo-lockup" aria-label="Kimbio home">
          <img src="/favicon.svg" alt="" className="marketing-logo-mark" width={26} height={26} />
          <span className="marketing-logo"><span>KIM</span>BIO</span>
        </a>

      {/* Desktop: a real dropdown with actual destinations, not just an anchor-scroll link. */}
      <nav aria-label="Marketing navigation" className="marketing-nav marketing-nav-desktop">
        {/*
          CLICK ONLY. Hover-to-open and click-to-toggle fought each other: to
          click the button you must first hover it, which OPENED the menu, and
          the click then toggled it closed. Net effect nothing — which measured
          as "15 links before, 15 after" and was indistinguishable from a
          missing handler. My own click fix created this by leaving the hover
          handlers in place.
          Hover-only menus also never open on touch, so click is the pattern
          that works everywhere rather than the one that works on a mouse.
        */}
        <div className="marketing-nav-dropdown-wrap" ref={exploreRef}>
          {/*
            CLICK, not hover only. The trigger had no onClick at all, so the
            menu opened on mouseenter and nothing else — a click did nothing,
            and on touch it could never open. aria-haspopup on a button that
            does not respond to activation is also a keyboard dead end.
          */}
          <button
            type="button"
            className="marketing-nav-dropdown-trigger"
            aria-expanded={exploreOpen}
            aria-haspopup="true"
            onClick={() => setExploreOpen((v) => !v)}
          >
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
        {/*
          Hidden, not removed. /login stays reachable by direct URL so invite
          links (/login?mode=signup&invite=…) still work and the owner can sign
          in — but a closed beta should not advertise a door that will not open.
        */}
        {signupOpen === true ? (
          <>
            <Link to="/login" className="marketing-nav-loglink">Log in</Link>
            <Link to="/login?mode=signup" className="marketing-nav-cta">Sign up</Link>
          </>
        ) : null}
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
            <span className="marketing-logo-lockup">
              <img src="/favicon.svg" alt="" className="marketing-logo-mark" width={26} height={26} />
              <span className="marketing-logo"><span>KIM</span>BIO</span>
            </span>
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
            {signupOpen === true ? (
              <>
                <Link to="/login" onClick={() => setMobileOpen(false)} className="marketing-button marketing-button-light">Log in</Link>
                <Link to="/login?mode=signup" onClick={() => setMobileOpen(false)} className="marketing-button marketing-button-primary">Sign up</Link>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </header>
    </div>
  );
}

export function MarketingPage() {
  const signupOpen = useSignupOpen();

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
          {/*
            THE ASK COMES BEFORE THE EVIDENCE.
            Measured live at 390x844 the CTA sat at top 814 with the cookie
            banner occupying 692-844 — below the fold AND underneath the banner.
            Measuring it without the banner said it was clear, which is the
            combination failing rather than either part.
            Ordering it above the board also stops the fold depending on HOW
            MANY RUNS ARE SCHEDULED: a heavier week would have pushed the CTA
            further down, so the fix is structural rather than a size tweak.
          */}
          {/*
            During the closed beta a stranger has NO path to an account, and the
            page says so instead of offering buttons that fail. "Browse public
            events" goes too — /events is no longer public, so it would land on
            the private-beta page, which is a dead end dressed as an invitation.
          */}
          {signupOpen === true ? (
            <>
              <div className="marketing-actions">
                <Link to="/login?mode=signup" className="marketing-button marketing-button-primary">Create your account</Link>
                <Link to="/events" className="marketing-button marketing-button-light">Browse public events <span aria-hidden="true">↗</span></Link>
              </div>
              <p className="marketing-note-warm">No login needed to look around.</p>
              <p className="marketing-consent-line">
                By creating an account you agree to our <Link to="/legal#terms">Terms</Link> and <Link to="/legal#privacy">Privacy Policy</Link>.
              </p>
            </>
          ) : signupOpen === false ? (
            <div className="marketing-actions">
              <a href="mailto:hello@getkimbio.com?subject=Kimbio%20beta" className="marketing-button marketing-button-primary">
                Email us for a spot
              </a>
            </div>
          ) : null}
          {signupOpen === false ? (
            <p className="marketing-note-warm">
              Kimbio is in a private beta with a small group in Columbia. We&apos;re opening up soon.
            </p>
          ) : null}
          {city ? <MarketingLiveBoard city={city} linkToEvents={signupOpen === true} /> : null}
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
        <BuildStamp className="!text-[#6b6e73]" />
        <span className="marketing-footer-links">
          <a href="https://facebook.com/getkimbio" target="_blank" rel="noopener noreferrer" aria-label="Kimbio on Facebook">Facebook</a>
          <a href="https://instagram.com/getkimbio" target="_blank" rel="noopener noreferrer" aria-label="Kimbio on Instagram">Instagram</a>
          <Link to="/sponsor">Sponsor Kimbio</Link>
          <Link to="/legal#terms">Terms</Link>
          <Link to="/legal#privacy">Privacy</Link>
        </span>
      </footer>
    </div>
  );
}
