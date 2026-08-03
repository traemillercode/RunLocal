/**
 * Auto-advancing numeric code entry (pure logic — unit tested).
 *
 * The UI renders one <input> per digit (inputMode="numeric", type="text"
 * with inputmode numeric so mobile keyboards show digits), and drives state
 * through these helpers so behavior is deterministic and testable:
 *  - typing a digit fills the focused box and advances focus
 *  - backspace on an empty box moves focus back
 *  - paste fills as many boxes as it has digits for
 *  - only 0–9 are accepted
 */

export const CODE_LENGTH = 6;

export interface CodeState {
  digits: string[];
  /** Index of the focused box (0-based). */
  focus: number;
}

export function emptyCodeState(): CodeState {
  return { digits: Array<string>(CODE_LENGTH).fill(""), focus: 0 };
}

export function codeValue(state: CodeState): string {
  return state.digits.join("");
}

export function isComplete(state: CodeState): boolean {
  return state.digits.every((d) => d !== "");
}

export function applyDigit(state: CodeState, ch: string): CodeState {
  if (!/^\d$/.test(ch)) return state;
  const digits = [...state.digits];
  digits[state.focus] = ch;
  return { digits, focus: Math.min(state.focus + 1, CODE_LENGTH - 1) };
}

export function applyBackspace(state: CodeState): CodeState {
  const digits = [...state.digits];
  if (digits[state.focus] !== "") {
    digits[state.focus] = "";
    return { digits, focus: state.focus };
  }
  return { digits, focus: Math.max(state.focus - 1, 0) };
}

export function applyPaste(state: CodeState, text: string): CodeState {
  const digitsOnly = text.replace(/\D/g, "").slice(0, CODE_LENGTH - state.focus);
  if (digitsOnly.length === 0) return state;
  const digits = [...state.digits];
  for (let i = 0; i < digitsOnly.length; i++) {
    digits[state.focus + i] = digitsOnly[i];
  }
  const focus = Math.min(state.focus + digitsOnly.length, CODE_LENGTH - 1);
  return { digits, focus };
}

export function setFocus(state: CodeState, index: number): CodeState {
  return { ...state, focus: Math.max(0, Math.min(index, CODE_LENGTH - 1)) };
}
