import type { NavigateFunction } from "react-router-dom";

/**
 * Leave an auth/provider callback without adding another entry behind it.
 * Callback routes replace the callback URL, so -1 returns to the page that
 * initiated the flow. A direct entry has no meaningful page to return to.
 */
export function cancelCallback(navigate: NavigateFunction, fallback: string, historyLength = window.history.length): void {
  if (historyLength > 1) navigate(-1);
  else navigate(fallback, { replace: true });
}
