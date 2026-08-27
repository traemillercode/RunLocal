/**
 * Solo-run scheduling — discoverable entry points (owner direction 2026-08-17:
 * "schedule your own runs that are by yourself").
 *
 * Locks the client-only surface: the EventsPage "Schedule my own run" CTA,
 * the shared SoloRunSheet's consent payload, the MyRunsHeader "Add solo run"
 * button, and solo-row Remove → deletePersonalRun wiring. The server stays the
 * authority for validation and privacy (visibility "private" is server-
 * enforced); these tests never touch src/server.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { buildSoloRunInput, SoloRunSheet, toSoloRunStartsAt } from "../src/components/SubmissionSheets";
import { MyRunsHeader, RunCard } from "../src/pages/MyRunsPage";
import type { MyRunView } from "../src/lib/api";

describe("SoloRunSheet — start-time transform and consent payload", () => {
  it("sends the datetime-local wall clock as the app's UTC-encoded label", () => {
    // Same convention ical.ts documents: wall-clock labels encoded in UTC
    // fields, so My Runs shows the exact time picked and ICS emits a floating
    // local time. The server regex requires a zone — this supplies it.
    expect(toSoloRunStartsAt("2026-08-20T18:00")).toBe("2026-08-20T18:00:00Z");
    expect(toSoloRunStartsAt("2026-08-20T18:00:00")).toBe(""); // input never has seconds
    expect(toSoloRunStartsAt("2026-08-20")).toBe("");
    expect(toSoloRunStartsAt("")).toBe("");
  });
  it("builds the exact createPersonalRun payload with consent always true", () => {
    expect(
      buildSoloRunInput("columbia-mo", { title: " Easy jog ", startsAt: "2026-08-20T18:00", locationLabel: " Stephens Lake ", distanceLabel: "3 miles" }),
    ).toEqual({
      cityId: "columbia-mo",
      title: "Easy jog",
      startsAt: "2026-08-20T18:00:00Z",
      locationLabel: "Stephens Lake",
      distanceLabel: "3 miles",
      notes: null,
      consent: true,
    });
    // Blank optional fields go to the server as null (never empty strings).
    expect(buildSoloRunInput("columbia-mo", { title: "Easy jog", startsAt: "2026-08-20T18:00", locationLabel: "", distanceLabel: "" })).toEqual({
      cityId: "columbia-mo",
      title: "Easy jog",
      startsAt: "2026-08-20T18:00:00Z",
      locationLabel: null,
      distanceLabel: null,
      notes: null,
      consent: true,
    });
  });
});

describe("SoloRunSheet — render", () => {
  it("renders the scheduling form with private-only framing and the consent checkbox", () => {
    const html = renderToStaticMarkup(<MemoryRouter><SoloRunSheet open onClose={() => {}} cityId="columbia-mo" /></MemoryRouter>);
    expect(html).toContain("Schedule my own run");
    expect(html).toContain("Private — only you can see it. It lands on My Runs and your calendar export.");
    expect(html).toContain("Run title");
    expect(html).toContain("Start time");
    expect(html).toContain("Location (optional)");
    expect(html).toContain("Distance (optional)");
    expect(html).toContain("I understand this run is private to my account.");
    expect(html).toContain("Schedule solo run");
    expect(html).not.toContain("columbia-mo"); // cityId is submit-only, never rendered
  });
  it("locks the submit wiring: createPersonalRun, success toast, close, and onScheduled callback", async () => {
    const source = await import("node:fs/promises").then((fs) => fs.readFile(new URL("../src/components/SubmissionSheets.tsx", import.meta.url), "utf8"));
    expect(source).toContain("api.createPersonalRun(buildSoloRunInput(cityId, f))");
    expect(source).toContain('toast("Solo run scheduled."');
    expect(source).toContain("onClose();");
    expect(source).toContain("onScheduled?.()");
    expect(source).toContain("consent: true");
    expect(source).toContain("visibility"); // never claimed as public — server stays authoritative
  });
});

describe("EventsPage — Schedule my own run CTA", () => {
  it("renders the CTA as a distinct second action with the private sublabel, gated like hosting", async () => {
    const source = await import("node:fs/promises").then((fs) => fs.readFile(new URL("../src/pages/EventsPage.tsx", import.meta.url), "utf8"));
    expect(source).toContain("Schedule my own run");
    expect(source).toContain("Private · just you");
    expect(source).toContain("openSolo");
    expect(source).toContain('if (role === "verified") setSoloSheetOpen(true)');
    expect(source).toContain("setGateOpen(true)");
    // The sheet is the shared one, wired to the current city and navigating to
    // My Runs on success so the runner sees the run land.
    expect(source).toContain("<SoloRunSheet open={soloSheetOpen}");
    expect(source).toContain("cityId={city.id}");
    expect(source).toContain('onScheduled={() => navigate("/my-runs")}');
    expect(source).toContain("useNavigate");
  });
});

describe("MyRunsHeader — Add solo run", () => {
  it("renders an Add solo run button beside the ICS export", () => {
    const html = renderToStaticMarkup(<MyRunsHeader view="list" onViewChange={() => {}} onAddSolo={() => {}} onLogRun={() => {}} />);
    expect(html).toContain('aria-label="Add solo run"');
    expect(html).toContain(">Add solo run</button>");
    expect(html).toContain('href="/api/my/runs/ical?tzOffsetMinutes='); // still beside the export
  });
  it("locks the page wiring: header opens the shared sheet; the sheet schedules and refreshes in place", async () => {
    const source = await import("node:fs/promises").then((fs) => fs.readFile(new URL("../src/pages/MyRunsPage.tsx", import.meta.url), "utf8"));
    expect(source).toContain("<MyRunsHeader view={view} onViewChange={setView} onAddSolo={() => setSoloOpen(true)} onLogRun={() => setLogRunOpen(true)} />");
    expect(source).toContain('<SoloRunSheet open={soloOpen} onClose={() => setSoloOpen(false)} cityId={cityId} onScheduled={load} />');
    // City id comes from the signed-in account (never a hardcoded city).
    expect(source).toContain('me.account.cityId ?? ""');
  });
});

describe("RunCard — solo delete gap", () => {
  const soloRun: MyRunView = {
    id: "solo-1", kind: "solo", eventId: "", occurrenceId: null, cityId: "columbia-mo",
    title: "Easy jog", date: "2026-08-20", time: "6:00 PM", location: "Stephens Lake", groupId: "",
    rsvpedAt: "2026-01-01T00:00:00Z", distanceLabel: "3 miles", startsAt: "2026-08-20T18:00:00.000Z",
    upcoming: true, past: false, kept: false, checkedIn: false,
  };
  it("shows the Remove control on solo rows with a solo-specific accessible label", () => {
    const html = renderToStaticMarkup(<MemoryRouter><RunCard run={soloRun} onRemove={() => {}} upcoming /></MemoryRouter>);
    expect(html).toContain('aria-label="Remove solo run for Easy jog"');
    expect(html).toContain(">Remove</button>");
    expect(html).not.toContain("Remove RSVP for");
  });
  it("locks the remove wiring: solo rows delete via deletePersonalRun with the occurrence-explicit toast", async () => {
    const source = await import("node:fs/promises").then((fs) => fs.readFile(new URL("../src/pages/MyRunsPage.tsx", import.meta.url), "utf8"));
    expect(source).toContain('run.kind === "solo"');
    expect(source).toContain("api.deletePersonalRun(run.id)");
    expect(source).toContain('Solo run removed for "');
    expect(source).toContain("Couldn't remove this solo run");
    expect(source).toContain("rsvpEvent(run.eventId, false, run.date, run.id)"); // RSVP path untouched
  });
});
