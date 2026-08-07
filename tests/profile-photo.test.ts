/**
 * End-to-end regression coverage for the public profile photo flow.
 *
 * Exercises the REAL HTTP contract (apiHandler) plus the file-backed store:
 *  - unauthenticated rejection (401)
 *  - JPEG / PNG / WebP validation and upload success
 *  - size limit + unsupported-MIME rejection (limits preserved)
 *  - profilePhotoRef persistence + /api/me profilePhotoUrl after a FRESH
 *    Db reload from disk (account refresh contract)
 *  - public upload bytes round-trip and static content-type mapping
 *    (the WebP MIME defect: accepted WebP was served as
 *    application/octet-stream before src/server/static.ts learned ".webp")
 *  - replacement cleanup: the previous public upload is deleted on disk
 *
 * Photos use real magic-byte payloads (PNG/JPEG/WebP signatures) so the byte
 * round-trip proves the exact accepted payload is what gets served.
 */
import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { apiHandler } from "../src/server/api";
import { staticHeaders } from "../src/server/static";
import { Db } from "../src/server/store";

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
const WEBP_BYTES = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x1c, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]);
const dataUrl = (mime: string, bytes: Buffer) => `data:${mime};base64,${bytes.toString("base64")}`;

function req(method: string, url: string, cookie?: string, body?: unknown): IncomingMessage {
  const raw = body === undefined ? "" : JSON.stringify(body);
  return {
    method,
    url,
    headers: { "content-type": "application/json", "x-forwarded-proto": "https", ...(cookie ? { cookie } : {}) },
    socket: { remoteAddress: "198.51.100.23" },
    [Symbol.asyncIterator]() {
      let done = false;
      return {
        next: async () =>
          done
            ? { done: true as const, value: undefined }
            : (done = true, { done: false as const, value: Buffer.from(raw) }),
      };
    },
  } as unknown as IncomingMessage;
}
function response() {
  const result = { status: 200, body: "" };
  const res = {
    writeHead(status: number) {
      result.status = status;
      return res;
    },
    setHeader() {
      return res;
    },
    end(chunk?: unknown) {
      if (chunk !== undefined) result.body += String(chunk);
      return res;
    },
  } as unknown as ServerResponse;
  return { res, result };
}
function session(db: Db) {
  const account = db.createAccount({ name: "Runner", email: `${Math.random()}@example.com`, cityId: "columbia-mo" });
  const s = db.createSession(account.id, "198.51.100.23");
  return { accountId: account.id, cookie: `runlocal_sid=${s.id}` };
}
async function uploadPhoto(db: Db, cookie: string, photo: string) {
  const { res, result } = response();
  await apiHandler(req("POST", "/api/profile/photo", cookie, { photo }), res, db);
  return { status: result.status, body: JSON.parse(result.body || "{}") as Record<string, unknown> };
}
async function getMe(db: Db, cookie: string) {
  const { res, result } = response();
  await apiHandler(req("GET", "/api/me", cookie), res, db);
  return { status: result.status, body: JSON.parse(result.body || "{}") as Record<string, unknown> };
}

describe("POST /api/profile/photo — HTTP contract", () => {
  it("rejects unauthenticated callers", async () => {
    const db = new Db({ dataDir: null });
    const { status, body } = await uploadPhoto(db, "", dataUrl("image/png", PNG_BYTES));
    expect(status).toBe(401);
    expect(body.error).toBe("sign_in_required");
  });
  it.each([
    ["jpeg", "image/jpeg", JPG_BYTES, "jpg"],
    ["png", "image/png", PNG_BYTES, "png"],
    ["webp", "image/webp", WEBP_BYTES, "webp"],
  ] as const)("accepts a %s upload and persists profilePhotoRef", async (_label, mime, bytes, ext) => {
    const db = new Db({ dataDir: null });
    const { accountId, cookie } = session(db);
    const { status, body } = await uploadPhoto(db, cookie, dataUrl(mime, bytes));
    expect(status).toBe(200);
    expect(body.photoUrl).toBe(`/uploads/public/${accountId}_profile.${ext}`);
    expect(db.getAccount(accountId)?.profilePhotoRef).toBe(`${accountId}_profile.${ext}`);
  });
  it("rejects unsupported MIME types", async () => {
    const db = new Db({ dataDir: null });
    const { cookie } = session(db);
    const { status, body } = await uploadPhoto(db, cookie, "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP");
    expect(status).toBe(400);
    expect(body.error).toBe("invalid_image");
  });
  it("rejects decoded images over the size limit", async () => {
    const db = new Db({ dataDir: null });
    const { cookie } = session(db);
    const oversized = `data:image/webp;base64,${Buffer.alloc(4 * 1024 * 1024 + 1).toString("base64")}`;
    const { status, body } = await uploadPhoto(db, cookie, oversized);
    expect(status).toBe(400);
    expect(body.error).toBe("image_too_large");
  });
});

describe("profile photo — file-backed persistence and serving", () => {
  it("persists profilePhotoRef and /api/me profilePhotoUrl across a fresh Db reload (account refresh contract)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "runlocal-photo-"));
    try {
      const db = new Db({ dataDir: dir });
      await db.load();
      const { accountId, cookie } = session(db);
      const uploaded = await uploadPhoto(db, cookie, dataUrl("image/webp", WEBP_BYTES));
      expect(uploaded.status).toBe(200);

      // Fresh Db instance, same data dir — simulates a server restart.
      const reloaded = new Db({ dataDir: dir });
      await reloaded.load();
      const rec = reloaded.getAccount(accountId)!;
      expect(rec.profilePhotoRef).toBe(`${accountId}_profile.webp`);
      const me = await getMe(reloaded, cookie);
      expect(me.status).toBe(200);
      expect((me.body.account as { profilePhotoUrl: string | null }).profilePhotoUrl).toBe(
        `/uploads/public/${accountId}_profile.webp`,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  it("writes the exact accepted bytes under uploads/public and maps WebP (and JPEG/PNG) to image content-types", async () => {
    const dir = await mkdtemp(join(tmpdir(), "runlocal-photo-"));
    try {
      const db = new Db({ dataDir: dir });
      await db.load();
      const { accountId, cookie } = session(db);
      const uploaded = await uploadPhoto(db, cookie, dataUrl("image/webp", WEBP_BYTES));
      expect(uploaded.status).toBe(200);

      const onDisk = await readFile(join(dir, "uploads", "public", `${accountId}_profile.webp`));
      expect(onDisk.equals(WEBP_BYTES)).toBe(true);

      // The defect: before ".webp" existed in STATIC_TYPES, serve.ts served
      // accepted WebP uploads as application/octet-stream via staticHeaders.
      const servedPath = `/uploads/public/${accountId}_profile.webp`;
      expect(staticHeaders(servedPath)["content-type"]).toBe("image/webp");
      expect(staticHeaders(`/uploads/public/${accountId}_profile.jpg`)["content-type"]).toBe("image/jpeg");
      expect(staticHeaders(`/uploads/public/${accountId}_profile.png`)["content-type"]).toBe("image/png");
      // Sibling MIME mappings are untouched.
      expect(staticHeaders("/app/icons/icon.png")["content-type"]).toBe("image/png");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  it("replaces the previous photo and deletes the old public upload from disk", async () => {
    const dir = await mkdtemp(join(tmpdir(), "runlocal-photo-"));
    try {
      const db = new Db({ dataDir: dir });
      await db.load();
      const { accountId, cookie } = session(db);

      const first = await uploadPhoto(db, cookie, dataUrl("image/png", PNG_BYTES));
      expect(first.status).toBe(200);
      const oldFile = join(dir, "uploads", "public", `${accountId}_profile.png`);
      await expect(readFile(oldFile)).resolves.toBeDefined();

      const second = await uploadPhoto(db, cookie, dataUrl("image/webp", WEBP_BYTES));
      expect(second.status).toBe(200);
      expect(db.getAccount(accountId)?.profilePhotoRef).toBe(`${accountId}_profile.webp`);
      // Old bytes are cleaned up; the replacement is served in their place.
      await expect(readFile(oldFile)).rejects.toThrow();
      const newFile = join(dir, "uploads", "public", `${accountId}_profile.webp`);
      expect((await readFile(newFile)).equals(WEBP_BYTES)).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
