import { describe, expect, it } from "vitest";
import { recoveryPasswordError } from "../src/pages/RecoveryPage";
describe("recovery password policy", () => {
 it("matches the signup policy", () => {
  expect(recoveryPasswordError("short1A", "short1A")).toBeNull();
  expect(recoveryPasswordError("abcdef1", "abcdef1")).toContain("lowercase");
  expect(recoveryPasswordError("Abcdefg", "Abcdefg")).toContain("digit");
  expect(recoveryPasswordError("abcdef1A", "abcdef1B")).toBe("Passwords do not match.");
 });
});
