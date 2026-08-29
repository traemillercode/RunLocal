import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { CITIES } from "../src/data/cities";
import { MarketingPage } from "../src/pages/MarketingPage";

describe("public marketing landing page", () => {
  it("has truthful hero, section copy, and public CTAs", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <MarketingPage />
      </MemoryRouter>,
    );
    expect(html).toContain("Columbia, MO");
    expect(html).toContain("Your run.");
    expect(html).toContain("Browse public events");
    expect(html).toContain("/events");
    expect(html).toContain("/login?mode=signup");
    expect(html).toContain("Verified-member posting is the next step");
    expect(html).toContain("Matching and discovery are planned");
  });

  it("labels provider availability honestly", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <MarketingPage />
      </MemoryRouter>,
    );
    expect(html).toContain("Strava");
    expect(html).toContain("Supported");
    expect(html).toContain("Strava connection is supported");
    expect(html.match(/Coming soon/g)?.length).toBe(3);
    expect(html).toContain("Garmin");
    expect(html).toContain("COROS");
    expect(html).toContain("Suunto");
  });

  it("renders a live, date-aware event board rather than a fixed list", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <MarketingPage />
      </MemoryRouter>,
    );
    // Previously this asserted three hardcoded titles, which only held because
    // the page rendered city.events.slice(0, 3) — date-blind. The board now
    // shows the soonest upcoming runs in a rolling 7-day window, so WHICH runs
    // appear legitimately depends on the day the test runs. Asserting titles
    // would make this fail every Tuesday for no reason.
    expect(html).toContain("marketing-live-board");

    const count = /marketing-live-count[^>]*><strong>(\d+)/.exec(html);
    expect(count).not.toBeNull();
    expect(Number(count![1])).toBeGreaterThan(0);

    // At most three cards, each drawn from the real seeded schedule.
    const titles = [...html.matchAll(/marketing-live-body"><h3>([^<]+)/g)].map((m) => m[1]);
    expect(titles.length).toBeGreaterThan(0);
    expect(titles.length).toBeLessThanOrEqual(3);
    const seeded = CITIES.find((c) => c.id === "columbia-mo")!.events.map((e) => e.title);
    for (const t of titles) expect(seeded).toContain(t);

    // Privacy: counts only. No member identities may reach an anonymous
    // visitor from the marketing page (D2).
    expect(html).not.toContain("avatar");
  });
});
