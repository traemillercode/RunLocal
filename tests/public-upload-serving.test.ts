/**
 * Regression coverage for the PUBLIC upload serving path in serve.ts — the
 * exact HTTP route that shipped a runtime 404 (serve.ts called extname()
 * without importing it, so every /uploads/public request threw inside the
 * handler and 404'd even though the file existed on disk). That defect was
 * invisible to typecheck (serve.ts is not in the tsconfig include) and to the
 * API-focused suites (they exercise apiHandler + staticHeaders, never the
 * static /uploads handler), so this test boots the REAL server on a scratch
 * port with a temp data dir and asserts the served status, content-type, and
 * exact bytes over HTTP.
 */
import { afterAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
// Real JPEG magic bytes plus a distinctive payload so the byte round-trip is
// meaningful (a shell page or 404 body can never match it).
const JPG_BYTES = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]),
  Buffer.from("run-local-public-upload-fixture"),
]);

let server: ChildProcess | undefined;
let dataDir: string | undefined;
let serverLog: Buffer[] = [];

async function waitForHealthy(port: number): Promise<void> {
  const deadline = Date.now() + 15_000;
  for (;;) {
    if (server?.exitCode !== null && server?.exitCode !== undefined) {
      throw new Error(`serve.ts exited early (code ${server.exitCode}): ${Buffer.concat(serverLog)}`);
    }
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (res.ok) return;
    } catch {
      // not listening yet
    }
    if (Date.now() > deadline) {
      throw new Error(`serve.ts did not become healthy in time: ${Buffer.concat(serverLog)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

afterAll(async () => {
  if (server) {
    server.kill("SIGTERM");
    await Promise.race([
      new Promise((resolve) => server!.once("exit", resolve)),
      new Promise((resolve) => setTimeout(resolve, 3_000)),
    ]);
  }
  if (dataDir) await rm(dataDir, { recursive: true, force: true });
});

describe("public upload serving (serve.ts static /uploads path)", () => {
  it(
    "serves /uploads/public over HTTP as image/jpeg and never exposes private uploads",
    async () => {
      dataDir = await mkdtemp(join(tmpdir(), "runlocal-uploads-"));
      await mkdir(join(dataDir, "uploads", "public"), { recursive: true });
      await mkdir(join(dataDir, "uploads", "private"), { recursive: true });
      await writeFile(join(dataDir, "uploads", "public", "fixture_profile.jpg"), JPG_BYTES);
      await writeFile(join(dataDir, "uploads", "private", "fixture_selfie.jpg"), JPG_BYTES);

      const port = 48_000 + Math.floor(Math.random() * 1_000);
      server = spawn("bun", ["run", "serve.ts"], {
        cwd: REPO_ROOT,
        env: {
          ...process.env,
          RUN_LOCAL_PORT: String(port),
          RUN_LOCAL_DATA_DIR: dataDir,
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      server.stdout?.on("data", (chunk: Buffer) => serverLog.push(chunk));
      server.stderr?.on("data", (chunk: Buffer) => serverLog.push(chunk));
      await waitForHealthy(port);

      // The public upload must round-trip with image/jpeg and exact bytes.
      const publicUrl = `http://127.0.0.1:${port}/uploads/public/fixture_profile.jpg`;
      const publicRes = await fetch(publicUrl);
      expect(publicRes.status).toBe(200);
      expect(publicRes.headers.get("content-type")).toBe("image/jpeg");
      expect(Buffer.from(await publicRes.arrayBuffer())).toEqual(JPG_BYTES);

      // Private selfies are never reachable over HTTP.
      const privateRes = await fetch(`http://127.0.0.1:${port}/uploads/private/fixture_selfie.jpg`);
      expect(privateRes.status).toBe(404);

      // Dot-segment traversal collapses to /uploads/private and is rejected too.
      const traversalRes = await fetch(
        `http://127.0.0.1:${port}/uploads/public/../private/fixture_selfie.jpg`,
      );
      expect(traversalRes.status).toBe(404);
    },
    30_000,
  );
});
