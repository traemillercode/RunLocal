import { Link } from "react-router-dom";
import { CITIES } from "../data/cities";

const city = CITIES.find((item) => item.id === "columbia-mo");
const previewEvents = city?.events.slice(0, 3) ?? [];

const sections = [
  { eyebrow: "Find your people", title: "Groups that feel local", body: "See the clubs and community run groups already moving Columbia. Listings are admin-seeded or approved community content—never invented social proof." },
  { eyebrow: "Plan the big day", title: "Races, without the rabbit holes", body: "Browse local race listings, dates, distances, and organizer links in one place." },
  { eyebrow: "Stay in the loop", title: "A better local running conversation", body: "Browse the local clubs directory and the public forum. Verified-member posting is the next step — identity review is already in place." },
];

export function MarketingPage() {
  return (
    <div className="marketing-page">
      <header className="marketing-header">
        <a href="#top" className="marketing-logo" aria-label="Run Local home"><span>RUN</span> LOCAL</a>
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
        </section>

        <section className="marketing-hook" aria-label="Run Local mission"><p>Running is better when the route comes with a <strong>reason to show up.</strong></p><span aria-hidden="true">✳</span></section>

        <section id="preview" className="marketing-section marketing-preview" aria-labelledby="preview-title">
          <p className="marketing-kicker">This week</p><h2 id="preview-title">What’s happening in Columbia</h2>
          <p className="marketing-muted">Public event listings from the launch city.</p>
          <div className="marketing-event-grid">{previewEvents.map((event) => <article className="marketing-event" key={event.id}><div className="marketing-event-mark" aria-hidden="true">↗</div><h3>{event.title}</h3><p>{event.time}</p><p>{event.location}</p><span>{event.distanceLabel}</span></article>)}</div>
          <Link to="/events" className="marketing-text-link">See all public events <span aria-hidden="true">→</span></Link>
        </section>

        <section id="how-it-works" className="marketing-section marketing-feature-section" aria-labelledby="features-title"><p className="marketing-kicker">The local layer</p><h2 id="features-title">More than a start line</h2><div className="marketing-feature-grid">{sections.map((section) => <article className="marketing-feature" key={section.title}><p className="marketing-kicker">{section.eyebrow}</p><h3>{section.title}</h3><p>{section.body}</p></article>)}</div></section>

        <section className="marketing-split-section" aria-labelledby="tools-title"><div><p className="marketing-kicker">Bring your miles</p><h2 id="tools-title">Your calendar,<br />your choices.</h2><p>Strava connection is supported. Garmin, COROS, and Suunto integrations are coming soon.</p></div><div className="marketing-status-list"><div><strong>Strava</strong><span className="status-live">Supported</span></div><div><strong>Garmin</strong><span>Coming soon</span></div><div><strong>COROS</strong><span>Coming soon</span></div><div><strong>Suunto</strong><span>Coming soon</span></div></div></section>

        <section className="marketing-trust" aria-labelledby="trust-title"><p className="marketing-kicker">Built with care</p><h2 id="trust-title">Useful, not noisy.</h2><p>Private My Runs, privacy-controlled Personal Runs, and identity verification are built for trust. Matching and discovery are planned—not quietly switched on.</p><div className="marketing-trust-tags"><span>Private by default</span><span>City-scoped</span><span>Human-reviewed</span></div></section>

        <section className="marketing-multicity" aria-labelledby="cities-title"><p className="marketing-kicker">Starting in Columbia</p><h2 id="cities-title">More cities,<br /><em>same local feeling.</em></h2><p>Columbia is live. We’re building the foundation to bring Run Local to more running communities next.</p></section>
        <section className="marketing-final" aria-labelledby="final-title"><h2 id="final-title">Make your next run<br /><em>a local one.</em></h2><Link to="/login?mode=signup" className="marketing-button marketing-button-primary">Join Run Local <span aria-hidden="true">↗</span></Link></section>
      </main>
      <footer className="marketing-footer"><span>RUN LOCAL</span><span>Columbia, MO · Launch city</span></footer>
    </div>
  );
}
