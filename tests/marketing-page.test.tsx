import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
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

  it("renders the current public Columbia event preview", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <MarketingPage />
      </MemoryRouter>,
    );
    expect(html).toContain("Monday Evening Social Run");
    expect(html).toContain("Tuesday Night Track");
    expect(html).toContain("Wednesday Hills @ Grindstone");
  });
});
