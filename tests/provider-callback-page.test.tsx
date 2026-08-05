import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { ProviderCallbackPage } from "../src/pages/ProviderCallbackPage";

vi.mock("../src/components/ui", () => ({ PillButton: ({ children }: { children: React.ReactNode }) => <button>{children}</button> }));
vi.mock("../src/lib/callbackNavigation", () => ({ cancelCallback: vi.fn() }));

describe("provider callback page", () => {
  it("honestly explains access denial without claiming a connection", () => {
    const html = renderToStaticMarkup(<MemoryRouter initialEntries={["/callback?error=access_denied"]}><ProviderCallbackPage /></MemoryRouter>);
    expect(html).toContain("Connection cancelled");
    expect(html).toContain("No activity access was granted");
    expect(html).not.toContain("connected");
    expect(html).not.toContain("successfully");
  });

  it("honestly handles an incomplete callback without claiming a token", () => {
    const html = renderToStaticMarkup(<MemoryRouter initialEntries={["/callback"]}><ProviderCallbackPage /></MemoryRouter>);
    expect(html).toContain("Connection not completed");
    expect(html).toContain("No token was saved");
    expect(html).not.toContain("Connection successful");
  });
});
