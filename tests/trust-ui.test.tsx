/**
 * UI-level tests (react-dom/server, no jsdom) for the trust & credentials
 * surface: profile credential list/submit form, the under-review banner,
 * appeal history, qualitative trust summary, and the admin trust tooling
 * (credential queue, appeal queue, threshold editor).
 *
 * Only presentational components are rendered — data fetching happens in the
 * server-backed containers; the server decides what any user may see.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AppealQueue, CredentialQueue, TrustThresholdEditor } from "../src/components/AdminTrustSection";
import { AppealForm, AppealHistory, CredentialList, CredentialSubmitForm, TrustSummary, UnderReviewBanner } from "../src/components/TrustProfileSection";
import type { AdminAppealRow, AdminCredentialRow, AppealView, CredentialView, PublicTrustView } from "../src/lib/api";

const creds: CredentialView[] = [
  { id: "aaa111aaa111aaa111aaa111aaa111aa", type: "coach_certification", certifyingBody: "RRCA", issuedOn: "2024-01-01", expiresOn: null, status: "pending_review", decisionReason: null, hasProof: true },
  { id: "bbb222bbb222bbb222bbb222bbb222bb", type: "first_aid_cpr", certifyingBody: "American Red Cross", issuedOn: null, expiresOn: "2027-06-01", status: "verified", decisionReason: null, hasProof: false },
  { id: "ccc333ccc333ccc333ccc333ccc333cc", type: "coach_certification", certifyingBody: "USATF", issuedOn: null, expiresOn: null, status: "rejected", decisionReason: "Document illegible", hasProof: true },
];

describe("profile credentials surface", () => {
  it("lists the user's own credential rows with statuses and owner-only proof links", () => {
    const html = renderToStaticMarkup(<CredentialList credentials={creds} />);
    expect(html).toContain("Coach certification");
    expect(html).toContain("RRCA");
    expect(html).toContain("Pending review");
    expect(html).toContain("Verified");
    expect(html).toContain("Expires 2027-06-01");
    expect(html).toContain("Why it was rejected");
    expect(html).toContain("Document illegible");
    expect(html).toContain("/api/credentials/aaa111aaa111aaa111aaa111aaa111aa/proof");
    expect(html).toContain("owner-only");
  });
  it("shows an empty state when there are no credentials", () => {
    const html = renderToStaticMarkup(<CredentialList credentials={[]} />);
    expect(html).toContain("No credentials on file yet");
  });
  it("submit form requires the coach proof path (label copy) and CPR self-attestation copy", () => {
    const html = renderToStaticMarkup(<CredentialSubmitForm busy={false} error={null} onSubmit={() => {}} onCancel={() => {}} />);
    expect(html).toContain("Coach certification");
    expect(html).toContain("First aid / CPR");
    expect(html).toContain("Certifying body");
    expect(html).toContain("Submit for review");
  });
  it("qualitative trust summary shows tier label and recognition chips, never numbers", () => {
    const trust: PublicTrustView = { tier: "recognized", coach: true, host: false, recognitions: [{ role: "coach", tier: "recognized" }] };
    const html = renderToStaticMarkup(<TrustSummary trust={trust} />);
    expect(html).toContain("Recognized in the community");
    expect(html).toContain("Recognized coach");
    expect(html).toContain("no scores, no rankings");
    expect(html).not.toContain("3 ratings");
    expect(html).not.toContain("42");
  });
  it("under-review banner is plain language and lists the preserved actions", () => {
    const trust: PublicTrustView = { tier: "new", coach: false, host: false, recognitions: [], underReview: true, restrictions: { hosting: true, coachPost: true } };
    const html = renderToStaticMarkup(<UnderReviewBanner trust={trust} />);
    expect(html).toContain("Account under community review");
    expect(html).toContain("browse, RSVP, and comment");
    expect(html).toContain("Hosting: paused");
    expect(html).toContain("Club / coach posting: paused");
  });
  it("appeal history shows statuses and admin decision reasons", () => {
    const appeals: AppealView[] = [
      { id: "a1", reason: "It was a misunderstanding", status: "reinstated", createdAt: "2026-08-01T00:00:00.000Z", decidedAt: "2026-08-02T00:00:00.000Z", decisionReason: "Alibi verified" },
      { id: "a2", reason: "Second appeal", status: "upheld", createdAt: "2026-08-03T00:00:00.000Z", decidedAt: null, decisionReason: null },
    ];
    const html = renderToStaticMarkup(<AppealHistory appeals={appeals} />);
    expect(html).toContain("Reinstated");
    expect(html).toContain("Upheld");
    expect(html).toContain("Admin decision");
    expect(html).toContain("Alibi verified");
  });
  it("appeal form explains the review process", () => {
    const html = renderToStaticMarkup(<AppealForm busy={false} error={null} onSubmit={() => {}} />);
    expect(html).toContain("File appeal");
  });
});

describe("admin trust tooling", () => {
  const credRows: AdminCredentialRow[] = [{ id: "d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1", accountId: "acc1", type: "coach_certification", certifyingBody: "RRCA", issuedOn: null, expiresOn: null }];
  it("credential queue shows pending rows, proof view link, and approve/reject controls", () => {
    const html = renderToStaticMarkup(<CredentialQueue rows={credRows} busyId={null} error={null} onDecide={() => {}} />);
    expect(html).toContain("Credential review");
    expect(html).toContain("Coach certification");
    expect(html).toContain("View proof");
    expect(html).toContain("/api/admin/credentials/d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1/proof");
    expect(html).toContain("Approve");
    expect(html).toContain("Reject");
  });
  it("appeal queue lists open appeals with Reinstate/Uphold and required-reason hint", () => {
    const rows: AdminAppealRow[] = [{ id: "e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1", accountId: "acc2", accountName: "Jordan Lee", accountEmail: "jordan@example.com", reason: "I never missed the safety briefing", status: "open", createdAt: "2026-08-01T00:00:00.000Z", decidedAt: null, decidedBy: null, decisionReason: null }];
    const html = renderToStaticMarkup(<AppealQueue rows={rows} busyId={null} error={null} onDecide={() => {}} />);
    expect(html).toContain("Jordan Lee");
    expect(html).toContain("Reinstate");
    expect(html).toContain("Uphold");
    expect(html).toContain("shown to the appellant");
  });
  it("threshold editor renders the current value and explains the policy", () => {
    const html = renderToStaticMarkup(<TrustThresholdEditor threshold={3} busy={false} error={null} onSave={() => {}} />);
    expect(html).toContain("Under-review threshold");
    expect(html).toContain("combined negative ratings + open concerns");
    expect(html).toContain("value=\"3\"");
    expect(html).toContain("Save threshold");
  });
});
