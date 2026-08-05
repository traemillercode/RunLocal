import { describe, expect, it } from "vitest";
import { changePasswordValidation } from "../src/pages/SettingsPage";

describe("settings password change validation", () => {
  it("rejects a weak password using the signup policy", () => {
    expect(changePasswordValidation("weak", "weak")).toMatch(/at least 6/i);
  });

  it("rejects mismatched confirmation", () => {
    expect(changePasswordValidation("Strong1", "Strong2")).toBe("Passwords do not match.");
  });

  it("accepts a matching password satisfying all requirements", () => {
    expect(changePasswordValidation("Strong1", "Strong1")).toBeNull();
  });
});
