import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const page = readFileSync("src/pages/RacesPage.tsx", "utf8");
const styles = readFileSync("src/styles/app.css", "utf8");

describe("Races desktop rail refinement", () => {
  it("uses a truthful wide-desktop rail with visible city/count context", () => {
    expect(page).toContain("desktop-races-layout");
    expect(page).toContain("RailStack");
    expect(page).toContain("Upcoming in ${city.name}");
    expect(page).toContain("{races.length} approved listing");
    expect(page).toContain("Verified runners can submit a race for review");
  });

  it("does not add fake filters or invented events", () => {
    expect(page).not.toMatch(/Filter|Sort by|All distances|Featured only/);
    expect(page).not.toContain("Upcoming races near you");
    expect(page).toContain("{races.map((r) =>");
  });

  it("keeps the action full width on mobile and compact at wide desktop", () => {
    expect(page).toContain("min-h-11 w-full items-center");
    expect(page).toContain("lg:w-auto lg:px-4");
    expect(page).toContain("lg:flex-row lg:items-center lg:justify-between");
    expect(page).toContain('lg:text-right');
  });

  it("only enables the 280px rail at 1180px and above", () => {
    expect(styles).toContain("@media (min-width: 1180px)");
    expect(styles).toContain("grid-template-columns: minmax(0, 1fr) 280px");
    expect(styles).toContain("@media (max-width: 1179px) { .desktop-races-rail { display: none; } }");
  });
});
