import type { AdminCtx, AdminResult } from "./admin";
import { authorizeScoped } from "./admin";
import type { Db } from "./store";

export interface AdminOverview {
  scope: { kind: "global" | "city"; cityId: string | null };
  generatedAt: string;
  queues: {
    pendingVerification: number;
    pendingSubmissions: number;
    openSafetyReports: number;
    contentNeedingReview: number;
  };
  analytics: {
    publishedContent: number | null;
    rsvpTotal: number | null;
    generatedAt: string;
    unavailable: boolean;
  };
}

/** Reason-gated, aggregate-only admin overview. No account or report fields leave this function. */
export function adminOverview(db: Db, ctx: AdminCtx, now = new Date()): AdminResult<AdminOverview> {
  const auth = authorizeScoped(db, ctx, "admin.overview", null, now);
  if (!auth.ok) return auth;
  const cityId = auth.data.scope.cityId;
  const inScope = (value: string | null) => cityId === null || value === cityId;
  const accounts = db.listAccounts().filter((a) => !a.deletedAt && inScope(a.cityId));
  const submissions = db.listSubmissions().filter((s) => inScope(s.cityId));
  const reports = db.listSafetyReports().filter((r) => inScope(r.cityId));
  const content = db.listContent().filter((c) => inScope(c.cityId));
  const events = db.listEvents().filter((e) => inScope(e.cityId));
  const eventIds = new Set(events.map((e) => e.id));
  const rsvpTotal = db.listAttendance().filter((a) => a.role === "rsvp" && eventIds.has(a.eventId)).length;
  const generatedAt = now.toISOString();
  return { ok: true, data: {
    scope: auth.data.scope,
    generatedAt,
    queues: {
      pendingVerification: accounts.filter((a) => a.status === "pending").length,
      pendingSubmissions: submissions.filter((s) => s.status === "pending").length,
      openSafetyReports: reports.filter((r) => r.status === "open" || r.status === "under_review").length,
      contentNeedingReview: content.filter((c) => c.hidden).length,
    },
    analytics: {
      publishedContent: content.filter((c) => !c.hidden).length,
      rsvpTotal,
      generatedAt,
      unavailable: false,
    },
  }};
}
