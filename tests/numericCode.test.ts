import { describe, expect, it } from "vitest";
import {
  CODE_LENGTH,
  applyBackspace,
  applyDigit,
  applyPaste,
  codeValue,
  emptyCodeState,
  isComplete,
  setFocus,
} from "../src/lib/numericCode";

describe("numeric code entry", () => {
  it("starts empty with focus on the first box", () => {
    const s = emptyCodeState();
    expect(s.digits).toHaveLength(CODE_LENGTH);
    expect(s.digits.every((d) => d === "")).toBe(true);
    expect(s.focus).toBe(0);
    expect(isComplete(s)).toBe(false);
  });

  it("accepts digits and auto-advances focus", () => {
    let s = emptyCodeState();
    s = applyDigit(s, "1");
    expect(s.digits[0]).toBe("1");
    expect(s.focus).toBe(1);
    s = applyDigit(s, "2");
    expect(s.digits[1]).toBe("2");
    expect(s.focus).toBe(2);
    expect(codeValue(s)).toBe("12");
  });

  it("ignores non-digits", () => {
    const s = applyDigit(emptyCodeState(), "a");
    expect(codeValue(s)).toBe("");
    expect(s.focus).toBe(0);
  });

  it("overwrites an already-filled box without advancing twice", () => {
    let s = emptyCodeState();
    s = applyDigit(s, "1"); // focus 1
    s = applyDigit(s, "2"); // focus 2
    s = setFocus(s, 0);
    s = applyDigit(s, "9"); // overwrites box 0
    expect(s.digits[0]).toBe("9");
    expect(s.focus).toBe(1);
  });

  it("backspace clears the current box, or moves back when empty", () => {
    let s = emptyCodeState();
    s = applyDigit(s, "1");
    s = applyDigit(s, "2"); // digits [1,2], focus 2
    // backspace on empty box 2 → focus 1
    s = applyBackspace(s);
    expect(s.focus).toBe(1);
    // backspace on filled box 1 → clears it
    s = applyBackspace(s);
    expect(s.digits[1]).toBe("");
    expect(s.focus).toBe(1);
  });

  it("never moves focus below zero", () => {
    let s = emptyCodeState();
    for (let i = 0; i < 5; i++) s = applyBackspace(s);
    expect(s.focus).toBe(0);
  });

  it("paste fills multiple boxes and advances focus", () => {
    let s = emptyCodeState();
    s = applyPaste(s, "123456");
    expect(codeValue(s)).toBe("123456");
    expect(s.focus).toBe(CODE_LENGTH - 1);
    expect(isComplete(s)).toBe(true);
  });

  it("paste strips non-digits and fills from the focus box", () => {
    let s = emptyCodeState();
    s = applyDigit(s, "1"); // focus 1
    s = applyPaste(s, "ab-23xx99"); // digits "2399" fill boxes 1..4
    expect(codeValue(s)).toBe("12399");
    expect(s.focus).toBe(5);
  });

  it("paste truncates to the number of remaining boxes", () => {
    let s = emptyCodeState();
    s = applyDigit(s, "1"); // focus 1, five boxes remain
    s = applyPaste(s, "23456789");
    expect(codeValue(s)).toBe("123456");
    expect(isComplete(s)).toBe(true);
  });

  it("completion requires every box filled", () => {
    let s = emptyCodeState();
    s = applyPaste(s, "12345");
    expect(isComplete(s)).toBe(false);
    s = applyDigit(s, "6");
    expect(codeValue(s)).toBe("123456");
    expect(isComplete(s)).toBe(true);
  });
});
