import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Db } from "../src/server/store";

describe("matching security limiter", () => {
  it("persists the per-account rolling window across a store restart and isolates accounts", async () => {
    const dir = await mkdtemp(join(tmpdir(), "runlocal-matching-") );
    try {
      const first = new Db({ dataDir: dir });
      await first.load();
      const now = Date.parse("2026-08-04T12:00:00.000Z");
      for (let i = 0; i < 10; i++) expect(first.consumeJoinRequestRate("account-a", now + i, 10, 60 * 60 * 1000)).toBe(true);
      expect(first.consumeJoinRequestRate("account-a", now + 10, 10, 60 * 60 * 1000)).toBe(false);
      expect(first.consumeJoinRequestRate("account-b", now + 10, 10, 60 * 60 * 1000)).toBe(true);
      await first.persist();
      const restarted = new Db({ dataDir: dir });
      await restarted.load();
      expect(restarted.consumeJoinRequestRate("account-a", now + 11, 10, 60 * 60 * 1000)).toBe(false);
      expect(restarted.consumeJoinRequestRate("account-a", now + 60 * 60 * 1000 + 1, 10, 60 * 60 * 1000)).toBe(true);
      expect(restarted.consumeJoinRequestRate("account-a", now + 60 * 60 * 1000 + 2, 10, 60 * 60 * 1000)).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
