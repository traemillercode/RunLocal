import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const publishScript = fileURLToPath(new URL("../publish.sh", import.meta.url));

describe("publish auth bridge verification", () => {
  it("checks SSR bridge markers and route-specific modulepreloads without hashed hrefs", async () => {
    const source = await readFile(publishScript, "utf8");

    expect(source).toContain("auth-bridge");
    expect(source).toContain("Log in to Run Local.");
    expect(source).toContain("Join Run Local.");
    expect(source).toMatch(/login-\[\^\"\]\+\\\.js/);
    expect(source).toMatch(/signup-\[\^\"\]\+\\\.js/);
    expect(source).not.toContain("grep -Fq '/app#/login'");
    expect(source).not.toContain("grep -Fq '/app#/login?mode=signup'");
  });
});
