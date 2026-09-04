/**
 * Two bugs on the messages screen, reported as one: the top of the view was cut
 * off, and it shifted down every time a different conversation loaded.
 *
 * They had separate causes and it is worth keeping them apart, because fixing
 * either alone would have left the other looking like the same bug.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const CSS = readFileSync(new URL("../src/styles/app.css", import.meta.url).pathname, "utf8");
const PAGE = readFileSync(new URL("../src/pages/MessagesPage.tsx", import.meta.url).pathname, "utf8");

describe("the shift: scroll the container, not the page", () => {
  it("does not use scrollIntoView", () => {
    /*
     * scrollIntoView walks UP the ancestor chain and scrolls every scrollable
     * parent it finds — including the document. So opening a thread scrolled
     * the PAGE as well as the message list, and `behavior: "smooth"` turned
     * that into a visible slide rather than a jump, which is why it read as
     * the view "shifting" rather than as a bug.
     *
     * A scrolled page also hides the top of a full-height layout, which is
     * where the "cuts off the top" half of the report came from.
     */
    // The name survives in the explanation of why it is gone; what must not
    // survive is a CALL.
    expect(PAGE).not.toMatch(/\.scrollIntoView\(/);
  });

  it("sets scrollTop on the thread's own container", () => {
    // Setting scrollTop on the element it belongs to cannot affect anything
    // above it — the containment is structural rather than a behaviour flag.
    expect(PAGE).toContain("const el = threadRef.current;");
    expect(PAGE).toContain("el.scrollTop = el.scrollHeight;");
  });

  it("the ref is on the scrolling element, not a child", () => {
    // A ref on the anchor div would put scrollTop on something with no
    // overflow, which silently does nothing.
    expect(PAGE).toContain('<div ref={threadRef} className="flex-1 space-y-3 overflow-y-auto py-4">');
  });

  it("re-runs when the conversation changes, not only on new messages", () => {
    // Switching threads keeps the same message count often enough that a
    // length-only dependency would leave the new thread scrolled wrong.
    expect(PAGE).toContain("}, [messages.length, conversationId]);");
  });
});

describe("the cutoff: heights are measured, not assumed", () => {
  it("derives the chat column from variables", () => {
    /*
     * It was `calc(100dvh - 4rem - 72px - safe-area)` — a hardcoded 64px for
     * the header and 72px for the bottom nav. Measured in a browser: the header
     * is 72px and the nav is 57px, so the column was 8px too tall and 15px
     * short of the nav at the same time.
     *
     * Hardcoded pixel copies of a component's height drift the moment the
     * component changes, and nothing fails when they do. --page-nav-h and
     * --page-bottom-gap already described the bottom bar, so that half stopped
     * being duplicated; the header got a variable for the same reason.
     */
    const rule = /\.messages-page-root \{([\s\S]*?)\}/.exec(CSS)?.[1] ?? "";
    expect(rule).toContain("var(--app-header-h)");
    expect(rule).toContain("var(--page-nav-h)");
    expect(rule).toContain("var(--page-bottom-gap)");
  });

  it("no longer hardcodes the old constants", () => {
    const rule = /\.messages-page-root \{([\s\S]*?)\}/.exec(CSS)?.[1] ?? "";
    expect(rule).not.toContain("4rem");
    expect(rule).not.toContain("72px");
  });

  it("the header variable exists and matches the measured height", () => {
    // 72px, measured at 390x844 rather than read off a class name.
    expect(CSS).toContain("--app-header-h: 72px;");
  });

  it("desktop subtracts only the header, since there is no bottom nav", () => {
    const desktop = /@media \(min-width: 1024px\) \{ \.messages-page-root \{([^}]*)\}/.exec(CSS)?.[1] ?? "";
    expect(desktop).toContain("var(--app-header-h)");
    expect(desktop).not.toContain("--page-nav-h");
  });
});
