/** Convert provider/API failures of unknown shape into safe UI text. */
export const DEFAULT_ERROR_MESSAGE = "Something went wrong. Please try again.";

export function normalizeErrorMessage(value: unknown, fallback = DEFAULT_ERROR_MESSAGE): string {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (value instanceof Error && value.message.trim()) return value.message.trim();
  if (value && typeof value === "object") {
    const message = (value as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message.trim();
  }
  return fallback;
}

/** String-only code extraction for untrusted API response bodies. */
export function normalizeErrorCode(value: unknown, fallback = "request_failed"): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}
