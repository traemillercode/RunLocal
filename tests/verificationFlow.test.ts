import { describe, expect, it } from "vitest";
import {
  canOpenCamera,
  initialState,
  stepForServerPhase,
  verifyReducer,
} from "../src/lib/verificationFlow";

describe("consent-before-camera invariant", () => {
  it("the camera can NEVER open before explicit consent", () => {
    const s = initialState();
    // Try to open the camera straight away — must be a no-op.
    const denied = verifyReducer(s, { type: "OPEN_CAMERA" });
    expect(denied.cameraOpen).toBe(false);
    expect(denied.phase).toBe("profile");
    // Even from the consent step without agreeing: no-op.
    const onConsent = verifyReducer(initialState(), { type: "GOTO", phase: "consent" });
    const stillDenied = verifyReducer(onConsent, { type: "OPEN_CAMERA" });
    expect(stillDenied.cameraOpen).toBe(false);
    expect(stillDenied.phase).toBe("consent");
  });

  it("GOTO camera is refused without consent from any state", () => {
    const s = verifyReducer(initialState(), { type: "GOTO", phase: "camera" });
    expect(s.phase).toBe("profile"); // refused
  });

  it("GOTO camera works only after SET_CONSENT(true)", () => {
    let s = verifyReducer(initialState(), { type: "GOTO", phase: "consent" });
    s = verifyReducer(s, { type: "SET_CONSENT", value: true });
    expect(canOpenCamera(s)).toBe(true);
    s = verifyReducer(s, { type: "OPEN_CAMERA" });
    expect(s.cameraOpen).toBe(true);
    expect(s.phase).toBe("camera");
  });

  it("unchecking consent revokes camera access", () => {
    let s = verifyReducer(initialState(), { type: "GOTO", phase: "consent" });
    s = verifyReducer(s, { type: "SET_CONSENT", value: true });
    s = verifyReducer(s, { type: "SET_CONSENT", value: false });
    expect(canOpenCamera(s)).toBe(false);
    const denied = verifyReducer(s, { type: "OPEN_CAMERA" });
    expect(denied.cameraOpen).toBe(false);
  });

  it("closing the camera returns to consent and keeps consent state", () => {
    let s = verifyReducer(initialState(), { type: "GOTO", phase: "consent" });
    s = verifyReducer(s, { type: "SET_CONSENT", value: true });
    s = verifyReducer(s, { type: "OPEN_CAMERA" });
    s = verifyReducer(s, { type: "CLOSE_CAMERA" });
    expect(s.cameraOpen).toBe(false);
    expect(s.phase).toBe("consent");
    expect(s.consentGiven).toBe(true);
  });

  it("submitted requires a captured selfie", () => {
    const s = verifyReducer(initialState(), { type: "SUBMITTED" });
    expect(s.phase).not.toBe("submitted");
    let s2 = verifyReducer(initialState(), { type: "GOTO", phase: "consent" });
    s2 = verifyReducer(s2, { type: "SET_CONSENT", value: true });
    s2 = verifyReducer(s2, { type: "OPEN_CAMERA" });
    s2 = verifyReducer(s2, { type: "SELFIE_CAPTURED", captured: true });
    s2 = verifyReducer(s2, { type: "SUBMITTED" });
    expect(s2.phase).toBe("submitted");
    expect(s2.serverPhase).toBe("pending_review");
  });
});

describe("resume mapping", () => {
  it("maps server phases to the right UI step", () => {
    expect(stepForServerPhase("email")).toBe("email");
    expect(stepForServerPhase("code")).toBe("email");
    expect(stepForServerPhase("selfie")).toBe("consent");
    expect(stepForServerPhase("pending_review")).toBe("submitted");
    expect(stepForServerPhase(null)).toBe("profile");
  });

  it("RESUME sets the phase from the server", () => {
    const s = verifyReducer(initialState(), { type: "RESUME", serverPhase: "pending_review" });
    expect(s.phase).toBe("submitted");
    const s2 = verifyReducer(initialState(), { type: "RESUME", serverPhase: "selfie" });
    expect(s2.phase).toBe("consent");
  });
});
