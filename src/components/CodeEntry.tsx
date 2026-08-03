/**
 * Shared 6-digit email verification code entry — auto-advancing numeric boxes
 * with `inputMode="numeric"`. Used by both the signup verification wizard and
 * the email sign-in flow. No SMS anywhere — this is the email code entry.
 */
import { useCallback, useRef } from "react";
import { applyBackspace, applyDigit, applyPaste, codeValue, isComplete, setFocus, type CodeState } from "../lib/numericCode";

export function CodeEntry({
  value,
  onChange,
  onComplete,
  disabled,
  label = "6-digit verification code",
}: {
  value: CodeState;
  onChange: (s: CodeState) => void;
  onComplete: (code: string) => void;
  disabled?: boolean;
  label?: string;
}) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const completedRef = useRef(false);

  const commit = useCallback(
    (next: CodeState) => {
      onChange(next);
      const el = refs.current[next.focus];
      if (el && document.activeElement !== el) el.focus();
      if (isComplete(next)) {
        if (!completedRef.current) {
          completedRef.current = true;
          onComplete(codeValue(next));
        }
      } else {
        completedRef.current = false;
      }
    },
    [onChange, onComplete],
  );

  return (
    <div className="flex justify-between gap-2" role="group" aria-label={label}>
      {value.digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="text"
          inputMode="numeric"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          maxLength={1}
          disabled={disabled}
          aria-label={`Digit ${i + 1}`}
          value={d}
          onChange={(e) => {
            const ch = e.target.value.slice(-1);
            if (ch === "") return;
            commit(applyDigit(value, ch));
          }}
          onKeyDown={(e) => {
            if (e.key === "Backspace") {
              e.preventDefault();
              commit(applyBackspace(value));
            }
          }}
          onPaste={(e) => {
            e.preventDefault();
            const text = e.clipboardData.getData("text");
            if (text) commit(applyPaste(value, text));
          }}
          onFocus={() => {
            const next = setFocus(value, i);
            if (next.focus !== value.focus) onChange(next);
            refs.current[i]?.select();
          }}
          className="h-14 w-11 rounded-xl border border-slate-300 bg-white text-center text-xl font-bold text-slate-900 outline-none focus:border-[#0b2b22] focus:ring-2 focus:ring-[#c8f169]/60 sm:w-12"
        />
      ))}
    </div>
  );
}
