import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { CITIES } from "../src/data/cities";
import { MarketingPage } from "../src/pages/MarketingPage";

describe("public marketing landing page", () => {
  it("keeps the public entry points, whatever the copy says", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <MarketingPage />
      </MemoryRouter>,
    );
    // CONTRACT, not copy. This previously pinned exact strings ("Your run.",
    // "Verified-member posting is the next step") that 1.4 replaced wholesale
    // when the live board became the hero — so it failed for describing a page
    // that no longer existed rather than for anything being wrong. Marketing
    // copy is expected to change; these four are what the page is FOR.
    /*
     * Two of these were "a guest can browse" and "a guest can convert". Neither
     * holds during the closed beta and both are correct again when it opens —
     * the page now renders NEITHER state until /api/signup-status resolves, so
     * a static render shows the neutral middle.
     *
     * What must hold in every mode: the city is named and the board is present.
     * Those are what the page is FOR, and they do not depend on whether the
     * door is open.
     */
    expect(html).toContain("Columbia, MO");
    expect(html).toContain("marketing-live-board");
  });

  it("never advertises a provider integration that does not exist", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <MarketingPage />
      </MemoryRouter>,
    );
    // The old version asserted the page NAMES Strava, Garmin, COROS and Suunto
    // with a "Coming soon" count of exactly 3. The page no longer mentions
    // providers at all — which is MORE honest, not less: /api/connections/strava
    // was removed from src/ entirely, so a page promising Strava connection
    // would now be advertising something a signup cannot deliver.
    //
    // Inverted to the invariant the original was protecting: if a provider is
    // named, it must not be presented as working. Survives providers returning
    // in roadmap 6.1 as read-only import.
    for (const provider of ["Strava", "Garmin", "COROS", "Suunto"]) {
      if (!html.includes(provider)) continue;
      const claim = new RegExp(`${provider}[^<]{0,60}(connected|supported|sync)`, "i");
      expect(html).not.toMatch(claim);
    }
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

    // The count is no longer wrapped in <strong> — it is a display-scale
    // tabular numeral with the unit in a span beside it, so the number is the
    // first text node inside the element.
    const count = /marketing-live-count[^>]*>(\d+)/.exec(html);
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
