import { describe, expect, it } from "vitest";
import { CITIES } from "../src/data/cities";
import { FORUM_SECTIONS, GROUP_TYPE_LABELS } from "../src/types";

describe("city-first data model", () => {
  it("has a live launch city and future-city placeholders", () => {
    expect(CITIES.length).toBeGreaterThanOrEqual(5);
    const live = CITIES.filter((c) => c.live);
    expect(live.length).toBe(1);
    expect(live[0].id).toBe("columbia-mo");
  });
});

describe("Columbia seed data", () => {
  const columbia = CITIES.find((c) => c.id === "columbia-mo")!;

  it("has believable weekly group runs with all required fields", () => {
    expect(columbia.events.length).toBeGreaterThanOrEqual(6);
    for (const e of columbia.events) {
      expect(e.title.length).toBeGreaterThan(3);
      expect(e.dayOfWeek).toBeGreaterThanOrEqual(0);
      expect(e.dayOfWeek).toBeLessThanOrEqual(6);
      expect(e.time).toMatch(/^(1[0-2]|0?[1-9]):[0-5]\d\s[AP]M$/);
      expect(e.location.length).toBeGreaterThan(5);
      expect(e.distanceLabel.length).toBeGreaterThan(3);
      expect(["Open to all", "Members + guests", "RSVP requested"]).toContain(e.invite);
    }
  });

  it("uses exactly the two allowed group-type labels", () => {
    expect(Object.keys(GROUP_TYPE_LABELS).sort()).toEqual(["community", "rrca-chartered"]);
    expect(GROUP_TYPE_LABELS["rrca-chartered"]).toBe("RRCA-Chartered Club");
    expect(GROUP_TYPE_LABELS.community).toBe("Community Run Group");
    for (const g of columbia.groups) {
      expect(GROUP_TYPE_LABELS[g.groupType]).toBeDefined();
    }
  });

  it("every event references a known group", () => {
    const ids = new Set(columbia.groups.map((g) => g.id));
    for (const e of columbia.events) expect(ids.has(e.groupId)).toBe(true);
  });

  it("races carry external registration URLs", () => {
    expect(columbia.races.length).toBeGreaterThanOrEqual(3);
    for (const r of columbia.races) {
      expect(r.registrationUrl).toMatch(/^https:\/\//);
      expect(r.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("forum has all three sections represented", () => {
    const sections = new Set(columbia.forum.map((p) => p.section));
    for (const s of FORUM_SECTIONS) expect(sections.has(s.id)).toBe(true);
    for (const p of columbia.forum) {
      expect(p.title.length).toBeGreaterThan(3);
      expect(p.replies).toBeGreaterThanOrEqual(0);
    }
  });

  it("Q&A section includes at least one unanswered question (for sorting)", () => {
    const qa = columbia.forum.filter((p) => p.section === "qa");
    expect(qa.some((p) => !p.answered)).toBe(true);
    expect(qa.some((p) => p.answered)).toBe(true);
  });
});
