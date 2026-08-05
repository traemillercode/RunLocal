import { describe, expect, it } from "vitest";
import { changePasswordValidation, passwordChangeEligibility } from "../src/pages/SettingsPage";

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

  it("allows only verified, non-suspended accounts", () => {
    expect(passwordChangeEligibility("verified", false)).toBeNull();
    expect(passwordChangeEligibility("pending", false)).toMatch(/verified/i);
    expect(passwordChangeEligibility("verified", true)).toMatch(/active/i);
  });
});
