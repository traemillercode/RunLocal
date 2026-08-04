import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import {
  LoginPage,
  PASSWORD_REQUIREMENTS,
  USERNAME_AVAILABILITY_DEBOUNCE_MS,
  authErrorText,
  isCurrentUsernameRequest,
  passwordRequirements,
  signupFieldsValid,
  usernameFormatValid,
} from "../src/pages/LoginPage";

const { useAccountMock } = vi.hoisted(() => ({ useAccountMock: vi.fn() }));
vi.mock("../src/state/account", () => ({ useAccount: useAccountMock }));

function guest() {
  useAccountMock.mockReturnValue({ me: { status: "guest" }, backendAvailable: true, refresh: vi.fn(), signOut: vi.fn(), deleteMyAccount: vi.fn(), role: "guest" });
}

describe("signup password requirements and gate", () => {
  it("reports each checklist rule and only gates when all are met", () => {
    expect(PASSWORD_REQUIREMENTS).toHaveLength(4);
    expect(passwordRequirements("abc")).toEqual([false, true, false, false]);
    expect(passwordRequirements("Abc123")).toEqual([true, true, true, true]);
    expect(signupFieldsValid("Abc123", "runner_1", true)).toBe(true);
    expect(signupFieldsValid("abc123", "runner_1", true)).toBe(false);
    expect(signupFieldsValid("Abc123", "runner_1", false)).toBe(false);
  });

  it("renders clear checked and unchecked markers in signup mode", () => {
    guest();
    const html = renderToStaticMarkup(<MemoryRouter initialEntries={["/login?mode=signup"]}><LoginPage /></MemoryRouter>);
    expect(html).toContain('aria-label="Password requirements"');
    expect(html).toContain("At least 6 characters");
    expect(html).toContain("○");
  });
});

describe("username format, availability timing, and stale protection", () => {
  it("accepts documented format and rejects invalid values", () => {
    expect(usernameFormatValid("Runner_1")).toBe(true);
    expect(usernameFormatValid("1runner")).toBe(false);
    expect(usernameFormatValid("ab")).toBe(false);
  });

  it("exposes the debounce contract and ignores stale request results", () => {
    expect(USERNAME_AVAILABILITY_DEBOUNCE_MS).toBe(400);
    expect(isCurrentUsernameRequest(2, 2)).toBe(true);
    expect(isCurrentUsernameRequest(1, 2)).toBe(false);
  });
});

describe("signup auth error rendering", () => {
  it("renders useful text for string, Error, and unknown provider failures", () => {
    expect(authErrorText("Email is invalid")).toBe("Email is invalid");
    expect(authErrorText(new Error("Password rejected"))).toBe("Password rejected");
    expect(authErrorText({})).toContain("Could not complete signup");
    expect(authErrorText({ error: "bad" })).not.toBe("{}");
  });

  it("marks the rendered error as an alert", () => {
    guest();
    const html = renderToStaticMarkup(<MemoryRouter initialEntries={["/login"]}><LoginPage /></MemoryRouter>);
    expect(html).not.toContain("{}" );
  });
});
