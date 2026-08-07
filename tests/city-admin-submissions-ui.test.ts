import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("City Admin submission queue UI contract", () => {
  const page = readFileSync(join(process.cwd(), "src/pages/AdminPage.tsx"), "utf8");
  const api = readFileSync(join(process.cwd(), "src/lib/api.ts"), "utf8");
  it("labels and scopes the queue", () => {
    expect(page).toContain("City submission queue");
    expect(page).toContain("enforced city scope");
    expect(page).toContain("cityAdminGetSubmissions");
    expect(page).toContain("cityAdminDecideSubmission");
  });
  it("uses city-scoped client endpoints and requires a reason", () => {
    expect(api).toContain("/api/admin/city/submissions");
    expect(api).toContain("/api/admin/city/submissions/${encodeURIComponent(id)}/${action}");
    expect(page).toContain("rejection reason");
    expect(page).toContain("min 5 characters");
    expect(page).toContain('"approve"');
    expect(page).toContain('"reject"');
  });
});
