/**
 * D2 privacy boundary on the now-public /events board.
 *
 * WRITTEN TO BE ABLE TO FAIL. The EventDetailPage lesson: a render with no data
 * cannot distinguish "gated" from "empty", so a test asserting "no initials
 * appear" would pass on an empty render regardless of whether the guard works.
 *
 * So every assertion here renders WITH real attendee data present, and checks
 * that the guest path does not carry it. The positive control at the end
 * proves the same component DOES render initials when signed in — without it,
 * the negative assertions could all be passing because the component simply
 * never draws initials at all.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import DepartureBoard from "../src/components/DepartureBoard";
import type { RunEvent } from "../src/components/DepartureBoard";

const ATTENDEES = [
  { id: "a1", initials: "TR", tone: 0 },
  { id: "a2", initials: "MK", tone: 1 },
  { id: "a3", initials: "JD", tone: 2 },
];

function event(over: Partial<RunEvent> = {}): RunEvent {
  return {
    id: "event:tuesday-tempo:2026-09-01",
    name: "Tuesday Tempo",
    type: "group",
    startsAt: new Date("2026-09-01T18:00:00Z"),
    venue: "Stephens Lake Park",
    area: "Columbia",
    paceLow: "No-drop",
    paceHigh: "",
    detail: "5 mi",
    host: { name: "Columbia Track Club", initials: "CT" },
    attendees: ATTENDEES,
    goingCount: 12,
    routePath: null,
    priceCents: 0,
    ...over,
  };
}


const render = (events: RunEvent[], signedIn: boolean) =>
  renderToStaticMarkup(
    <MemoryRouter>
      <DepartureBoard events={events} onHostRun={() => {}} signedIn={signedIn} />
    </MemoryRouter>,
  );

describe("signed-out board carries no member identities", () => {
  it("POSITIVE CONTROL: signed in, the same data DOES render initials", () => {
    // Without this the negative tests below could all pass because the
    // component never draws initials under any circumstances.
    const html = render([event()], true);
    expect(html).toContain("TR");
    expect(html).toContain("MK");
  });

  it("signed out, attendee initials are absent even when attendees are passed", () => {
    // Passing attendees deliberately: the page will not do this for a guest,
    // but the component must not leak them if it ever did.
    const html = render([event()], false);
    for (const initials of ["TR", "MK", "JD"]) {
      expect(html).not.toContain(`>${initials}<`);
    }
  });

  it("signed out with NO attendees, the going count still renders", () => {
    // This is what the page actually does. The count is real proof of activity
    // and carries no identity, so it must survive.
    const html = render([event({ attendees: [] })], false);
    expect(html).toContain("12");
  });
});

describe("signed-out board offers no write actions", () => {
  it("does not offer Host a run", () => {
    const html = render([event()], false);
    expect(html).not.toContain("Host a run");
  });

  it("POSITIVE CONTROL: signed in, Host a run IS offered", () => {
    expect(render([event()], true)).toContain("Host a run");
  });

  it("shows no moderation affordances", () => {
    const html = render([event()], false).toLowerCase();
    for (const word of ["moderat", "approve", "reject", "hide run", "archive"]) {
      expect(html).not.toContain(word);
    }
  });
});
