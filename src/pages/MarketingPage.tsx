import { Link } from "react-router-dom";
import { CITIES } from "../data/cities";

const city = CITIES.find((item) => item.id === "columbia-mo");
const previewEvents = city?.events.slice(0, 3) ?? [];

const sections = [
  { eyebrow: "Find your people", title: "Groups that feel local", body: "Real clubs and community run groups already moving in Columbia — no fake crowds, no empty listings, just who's actually out there." },
  { eyebrow: "Plan the big day", title: "Races, without the rabbit holes", body: "Every local race in one place — dates, distances, and a straight link to sign up. No more ten open tabs." },
  { eyebrow: "Stay in the loop", title: "A better local running conversation", body: "Ask a gear question, find a pace group, post a route — a running forum without the spam, because everyone here is a real, verified runner." },
];

/** Columbia, MO trail classics for the showcase. Distance/elevation are real published figures for these trails; there's no GPX-backed route detail page yet, so no fabricated elevation graphic is shown here - that's the next real piece to build. */
const FEATURED_ROUTES = [
  { name: "MKT Nature Trail", surface: "Gravel", distance: "8.9 mi", elevation: "120 ft" },
  { name: "Rock Bridge — Devil's Icebox", surface: "Trail", distance: "3.9 mi", elevation: "310 ft" },
  { name: "Grindstone Loop", surface: "Trail", distance: "8.1 mi", elevation: "480 ft" },
];

export function MarketingPage() {
  return (
    <div className="marketing-page">
      <header className="marketing-header">
        <a href="#top" className="marketing-logo" aria-label="Kimbio home"><span>KIM</span>BIO</a>
        <nav aria-label="Marketing navigation" className="marketing-nav">
          <a href="#preview">Explore</a><a href="#how-it-works">How it works</a><Link to="/login?mode=signup" className="marketing-nav-cta">Sign up</Link>
        </nav>
      </header>
      <main id="top">
        <section className="marketing-hero" aria-labelledby="hero-title">
          <p className="marketing-kicker">Columbia, MO <span aria-hidden="true">·</span> Live now</p>
          <h1 id="hero-title">Your run.<br /><em>Your people.<br />Your city.</em></h1>
          <p className="marketing-lede">Real group runs, local races, and the people who make running in Columbia feel like home.</p>
          <div className="marketing-actions"><Link to="/events" className="marketing-button marketing-button-primary">Browse public events <span aria-hidden="true">↗</span></Link><Link to="/login?mode=signup" className="marketing-button marketing-button-light">Create your account</Link></div>
          <p className="marketing-note">No login needed to look around.</p>
          <div className="marketing-stat-pills">
            <span className="marketing-stat-pill"><strong>100%</strong> identity-verified</span>
            <span className="marketing-stat-pill"><strong>3</strong> weekly group runs</span>
            <span className="marketing-stat-pill"><strong>0</strong> fake followers</span>
          </div>
        </section>

        <section className="marketing-hook" aria-label="Kimbio mission"><p>Running is better when the route comes with a <strong>reason to show up.</strong></p><span aria-hidden="true">✳</span></section>

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
                <div className="marketing-route-photo">
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

        <section id="how-it-works" className="marketing-section marketing-feature-section" aria-labelledby="features-title"><p className="marketing-kicker">The local layer</p><h2 id="features-title">More than a start line</h2><div className="marketing-feature-grid">{sections.map((section) => <article className="marketing-feature" key={section.title}><p className="marketing-kicker">{section.eyebrow}</p><h3>{section.title}</h3><p>{section.body}</p></article>)}</div></section>

        <section className="marketing-split-section" aria-labelledby="tools-title"><div><p className="marketing-kicker">Log it your way</p><h2 id="tools-title">Every run,<br />on your terms.</h2><p>No auto-sync, no algorithm deciding what counts. Log your distance, pace, and surface — add a photo, a voice note, or tag who you ran with. Intentional, not automatic.</p></div></section>

<section className="marketing-trust" aria-labelledby="trust-title"><p className="marketing-kicker">Built with care</p><h2 id="trust-title">Useful, not noisy.</h2><p>Your runs stay yours — private by default, with real identity verification behind every profile. No feeds to game, no fake followers, no features that quietly turn on without telling you.</p><div className="marketing-trust-tags"><span>Private by default</span><span>City-scoped</span><span>Human-reviewed</span></div></section>
        <section className="marketing-multicity" aria-labelledby="cities-title"><p className="marketing-kicker">Starting in Columbia</p><h2 id="cities-title">More cities,<br /><em>same local feeling.</em></h2><p>Columbia is live. We’re building the foundation to bring Kimbio to more running communities next.</p></section>
        <section className="marketing-final" aria-labelledby="final-title"><h2 id="final-title">Make your next run<br /><em>a local one.</em></h2><Link to="/login?mode=signup" className="marketing-button marketing-button-primary">Join Kimbio <span aria-hidden="true">↗</span></Link></section>
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
