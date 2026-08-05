import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { GroupMembershipAction } from "../src/pages/GroupsPage";

vi.mock("../src/state/account", () => ({ useAccount: () => ({ me: null, role: "guest" }) }));

describe("Groups directory membership gate", () => {
  it("gives guests sign-in and sign-up routes instead of a request action", () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter><GroupMembershipAction signedIn={false} onRequest={() => {}} /></MemoryRouter>,
    );
    expect(markup).toContain("Sign in or create an account to request membership.");
    expect(markup).toContain('href="/login"');
    expect(markup).toContain('href="/login?mode=signup"');
    expect(markup).not.toContain("Request membership");
    expect(markup).not.toContain("<button");
  });

  it("keeps the request action for signed-in users", () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter><GroupMembershipAction signedIn onRequest={() => {}} /></MemoryRouter>,
    );
    expect(markup).toContain("Request membership");
    expect(markup).toContain("<button");
    expect(markup).not.toContain("Sign in or create an account");
  });
});
