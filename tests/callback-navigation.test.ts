import { describe, expect, it, vi } from "vitest";
import { cancelCallback } from "../src/lib/callbackNavigation";

describe("callback cancellation navigation", () => {
  it("returns to the initiating page with Back instead of replacing it", () => {
    const navigate = vi.fn();
    cancelCallback(navigate, "/", 3);
    expect(navigate).toHaveBeenCalledWith(-1);
    expect(navigate).not.toHaveBeenCalledWith("/", { replace: true });
  });

  it("uses a replace fallback for direct callback entry", () => {
    const navigate = vi.fn();
    cancelCallback(navigate, "/login", 1);
    expect(navigate).toHaveBeenCalledWith("/login", { replace: true });
  });
});
