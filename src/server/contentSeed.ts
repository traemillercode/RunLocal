/**
 * Owner-dashboard seed: mirrors the client's city-first seed data
 * (src/data/cities.ts — the ONE source of truth for content) into the
 * server-side moderation registry so owner decisions (hidden / featured /
 * pinned / RRCA badge) persist per city.
 *
 * Truthfulness: the app's events/races/forum are sample preview content, and
 * the sample flags seeded here are explicitly labeled "Sample report (preview
 * data)" — they exist so the dashboard is demonstrable before real user
 * reporting exists. No fake moderation claim is made.
 */
import { CITIES } from "../data/cities";
import type { ContentRecord, GroupModRecord } from "./types";
import type { Db } from "./store";

/** Upsert every seeded group/event/race/post into the moderation registry. */
export function seedContentRegistry(db: Db, cities = CITIES): void {
  for (const city of cities) {
    for (const g of city.groups) {
      // Only insert records that don't exist yet — re-seeding must NEVER
      // overwrite owner decisions (hidden/featured/pinned/RRCA).
      if (db.getGroup(g.id)) continue;
      const rec: GroupModRecord = {
        id: g.id,
        cityId: city.id,
        name: g.name,
        // Seed truth: the "RRCA-Chartered Club" label is admin-assigned in the
        // seed data, so the badge default mirrors the seeded groupType.
        rrcaBadge: g.groupType === "rrca-chartered",
        rrcaNote: null,
        rrcaNoteUpdatedAt: null,
      };
      db.upsertGroup(rec);
    }
    for (const e of city.events) {
      if (db.getContent(`event:${e.id}`)) continue;
      const rec: ContentRecord = {
        id: `event:${e.id}`,
        cityId: city.id,
        kind: "event",
        refId: e.id,
        title: e.title,
        authorLabel: null,
        authorAccountId: null,
        featured: false,
        pinned: false,
        hidden: false,
        hiddenAt: null,
      };
      db.upsertContent(rec);
    }
    for (const r of city.races) {
      if (db.getContent(`race:${r.id}`)) continue;
      const rec: ContentRecord = {
        id: `race:${r.id}`,
        cityId: city.id,
        kind: "race",
        refId: r.id,
        title: r.name,
        authorLabel: r.organizer,
        authorAccountId: null,
        featured: false,
        pinned: false,
        hidden: false,
        hiddenAt: null,
      };
      db.upsertContent(rec);
    }
    for (const p of city.forum) {
      if (db.getContent(`post:${p.id}`)) continue;
      const rec: ContentRecord = {
        id: `post:${p.id}`,
        cityId: city.id,
        kind: "post",
        refId: p.id,
        title: p.title,
        authorLabel: p.author,
        authorAccountId: null,
        featured: false,
        pinned: false,
        hidden: false,
        hiddenAt: null,
      };
      db.upsertContent(rec);
    }
  }
}

/**
 * Seed a few clearly-labeled sample flags ONLY when the flag list is empty
 * (so owner decisions are never overwritten — a dismissed flag remains in the
 * list, which prevents re-seeding). No-op once any flag exists.
 */
export function seedSampleFlags(db: Db, now = new Date(), cities = CITIES): void {
  if (db.listFlags().length > 0) return;
  const city = cities.find((c) => c.id === "columbia-mo");
  if (!city) return;
  const refs: { kind: "event" | "race" | "post"; refId: string; reason: string }[] = [
    {
      kind: "post",
      refId: "p4",
      reason: "Sample report (preview data): reported as a duplicate thread by a preview-data reporter.",
    },
    {
      kind: "event",
      refId: "mon-social",
      reason: "Sample report (preview data): listed meeting spot may have changed — verify before the next run.",
    },
    {
      kind: "race",
      refId: "r2",
      reason: "Sample report (preview data): registration price may be outdated — confirm on the organizer's site.",
    },
  ];
  for (const r of refs) {
    const content = db.getContent(`${r.kind}:${r.refId}`);
    if (!content) continue;
    db.appendFlag(
      {
        cityId: city.id,
        contentId: content.id,
        kind: r.kind,
        refId: r.refId,
        title: content.title,
        reason: r.reason,
        reporterName: "Sample report (preview data)",
        reporterAccountId: null,
        status: "open",
        resolvedAt: null,
        resolvedAction: null,
      },
      now,
    );
  }
}
