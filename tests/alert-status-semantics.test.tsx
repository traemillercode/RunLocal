import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { RecoveryPage } from "../src/pages/RecoveryPage";
import { GroupMembershipAction } from "../src/pages/GroupsPage";

describe("alert/status semantics", () => {
  it("marks recovery errors as alerts", () => {
    const html = renderToStaticMarkup(<MemoryRouter><RecoveryPage sessionError="Expired link" /></MemoryRouter>);
    expect(html).toContain('role="alert"');
  });
  it("keeps group request feedback as status", () => {
    const html = renderToStaticMarkup(<GroupMembershipAction signedIn onRequest={() => {}} />);
    expect(html).not.toContain('role="alert"');
  });
});
