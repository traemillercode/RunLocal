/**
 * SSR/no-jsdom tests for the tour card markup (react-dom/server).
 *
 * Renders the real TourCard via renderToStaticMarkup — no DOM, no router, no
 * account context — and asserts the dialog semantics, step progress, honest
 * button labels, and first/last-step states.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TourCard } from "../src/components/TourHost";
import { TOUR_STEPS } from "../src/lib/tour";

const noop = () => {};

function renderCard(index: number) {
  return renderToStaticMarkup(
    <TourCard step={TOUR_STEPS[index]} index={index} total={TOUR_STEPS.length} onBack={noop} onNext={noop} onSkip={noop} />,
  );
}

describe("TourCard (SSR markup)", () => {
  it("renders a modal dialog labelled by the step title", () => {
    const html = renderCard(0);
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain(`aria-labelledby="tour-card-title-${TOUR_STEPS[0].id}"`);
    expect(html).toContain(TOUR_STEPS[0].title);
    // renderToStaticMarkup escapes apostrophes to &#x27; — assert the escaped body.
    expect(html).toContain(TOUR_STEPS[0].body.split("'").join("&#x27;"));
  });

  it("shows progress '1 of 6' on the first step and '6 of 6' on the last", () => {
    expect(renderCard(0)).toContain("Welcome tour · 1 of 6");
    expect(renderCard(TOUR_STEPS.length - 1)).toContain("Welcome tour · 6 of 6");
  });

  it("shows Skip and Next on the first step but no Back", () => {
    const html = renderCard(0);
    expect(html).toContain(">Skip</button>");
    expect(html).toContain(">Next</button>");
    expect(html).not.toContain(">Back</button>");
  });

  it("shows Back on intermediate steps and Done (not Next) on the last", () => {
    const mid = renderCard(3);
    expect(mid).toContain(">Back</button>");
    expect(mid).toContain(">Next</button>");
    const last = renderCard(TOUR_STEPS.length - 1);
    expect(last).toContain(">Back</button>");
    expect(last).toContain(">Done</button>");
    expect(last).not.toContain(">Next</button>");
  });

  it("keeps the step pointer label and the target hint in the card", () => {
    const html = renderCard(4);
    // renderToStaticMarkup escapes the ampersand in text nodes.
    expect(html).toContain(TOUR_STEPS[4].targetLabel.replace("&", "&amp;"));
  });
});
