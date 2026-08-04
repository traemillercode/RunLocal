import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, createAccount, normalizeAccountResponse } from "../src/lib/api";

afterEach(() => vi.unstubAllGlobals());

describe("signup account API client", () => {
  it.each([null, {}, { html: "<html>SPA</html>" }])("rejects malformed success body %j", (body) => {
    const result = normalizeAccountResponse(body);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(ApiError);
      expect(result.error.code).toBe("invalid_response");
      expect(result.error.message).toContain("invalid account response");
    }
  });

  it("turns SPA HTML fallback into a readable error instead of success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<!doctype html><html>SPA</html>", { status: 200, headers: { "content-type": "text/html" } })));
    const result = await createAccount({ name: "Runner", username: "runnerone", email: "runner@example.com", birthdate: "1990-01-01", cityId: "columbia-mo" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain("invalid response");
  });

  it("preserves readable API error bodies and status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "username_taken", message: "That username is already taken." }), { status: 409 })));
    const result = await createAccount({ name: "Runner", username: "runnerone", email: "runner@example.com", birthdate: "1990-01-01", cityId: "columbia-mo" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.status).toBe(409);
      expect(result.error.code).toBe("username_taken");
      expect(result.error.message).toBe("That username is already taken.");
    }
  });

  it("accepts the account response and sends metadata without a password", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ account: { id: "a", status: "pending" } }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await createAccount({ name: "Runner", username: "runnerone", email: "runner@example.com", birthdate: "1990-01-01", cityId: "columbia-mo", noSession: true });
    expect(result.ok).toBe(true);
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(String(init.body)).not.toContain("password");
    expect(String(init.body)).toContain("runnerone");
  });
});
