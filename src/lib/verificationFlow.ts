/**
 * Verification flow state machine (pure logic — unit tested).
 *
 * The critical invariant: the camera MUST NOT open before explicit consent.
 * `OPEN_CAMERA` is a no-op unless `consentGiven` is true, and `gotoPhase`
 * refuses to enter the camera phase without consent. This is enforced in the
 * UI (buttons are disabled) AND here in the state machine, and covered by
 * tests in tests/verificationFlow.test.ts.
 */

export type FlowPhase = "profile" | "email" | "code" | "consent" | "camera" | "submitted";

export interface FlowState {
  phase: FlowPhase;
  consentGiven: boolean;
  cameraOpen: boolean;
  selfieCaptured: boolean;
  /** Server-reported pending stage (used to resume mid-flow). */
  serverPhase: "email" | "code" | "selfie" | "pending_review" | null;
}

export type FlowAction =
  | { type: "RESUME"; serverPhase: FlowState["serverPhase"] }
  | { type: "GOTO"; phase: FlowPhase }
  | { type: "SET_CONSENT"; value: boolean }
  | { type: "OPEN_CAMERA" }
  | { type: "CLOSE_CAMERA" }
  | { type: "SELFIE_CAPTURED"; captured: boolean }
  | { type: "SUBMITTED" };

export function initialState(): FlowState {
  return { phase: "profile", consentGiven: false, cameraOpen: false, selfieCaptured: false, serverPhase: null };
}

/** Map the server-reported phase to the first UI step the user must complete. */
export function stepForServerPhase(serverPhase: FlowState["serverPhase"]): FlowPhase {
  switch (serverPhase) {
    case "email":
    case "code":
      return "email";
    case "selfie":
      return "consent";
    case "pending_review":
      return "submitted";
    default:
      return "profile";
  }
}

export function verifyReducer(state: FlowState, action: FlowAction): FlowState {
  switch (action.type) {
    case "RESUME":
      return {
        ...state,
        serverPhase: action.serverPhase,
        phase: stepForServerPhase(action.serverPhase),
      };
    case "GOTO": {
      if (action.phase === "camera" && !state.consentGiven) return state; // consent first — always
      if (action.phase === "submitted" && !state.selfieCaptured) return state;
      return { ...state, phase: action.phase, cameraOpen: action.phase === "camera" ? state.cameraOpen : false };
    }
    case "SET_CONSENT":
      return { ...state, consentGiven: action.value };
    case "OPEN_CAMERA": {
      // The hard rule: consent must be given and we must be on the consent step.
      if (!state.consentGiven || state.phase !== "consent") return state;
      return { ...state, cameraOpen: true, phase: "camera" };
    }
    case "CLOSE_CAMERA":
      return { ...state, cameraOpen: false, phase: "consent" };
    case "SELFIE_CAPTURED":
      return { ...state, selfieCaptured: action.captured };
    case "SUBMITTED":
      if (!state.selfieCaptured) return state; // never submit without a capture
      return { ...state, phase: "submitted", cameraOpen: false, serverPhase: "pending_review" };
  }
}

/** Convenience: can we open the camera from the consent step? */
export function canOpenCamera(state: FlowState): boolean {
  return state.consentGiven && state.phase === "consent";
}
