import { apiHandler, SESSION_COOKIE } from "./src/server/api";
import { createMemoryStore } from "./src/server/store";
import { seedContentRegistry } from "./src/server/contentSeed";
import type { IncomingMessage, ServerResponse } from "node:http";

function req(method: string, path: string, cookie?: string, body?: unknown): IncomingMessage {
  const raw = body === undefined ? "" : JSON.stringify(body);
  let sent = false;
  const headers: Record<string, string> = { "x-forwarded-proto": "https", ...(raw ? { "content-type": "application/json" } : {}) };
  if (cookie) headers.cookie = cookie;
  return { method, url: path, headers, socket: { remoteAddress: "127.0.0.1" }, [Symbol.asyncIterator]() { return { next: async () => sent ? { done: true as const, value: undefined } : (sent = true, { done: false as const, value: Buffer.from(raw) }) }; } } as unknown as IncomingMessage;
}
function response() {
  const out = { status: 0, body: "" };
  const res = { writeHead(status: number) { out.status = status; return res; }, setHeader() { return res; }, end(value?: unknown) { if (value !== undefined) out.body += String(value); return res; } } as unknown as ServerResponse;
  return { res, out };
}
async function call(db: any, method: string, path: string, cookie?: string, body?: unknown) {
  const { res, out } = response();
  await apiHandler(req(method, path, cookie, body), res, db);
  return { status: out.status, body: out.body ? JSON.parse(out.body) : {} };
}

async function main() {
  const db = createMemoryStore();
  seedContentRegistry(db);
  const canonicalRes = await call(db, "GET", "/api/events?city=columbia-mo");
  console.log("Canonical events count:", canonicalRes.body.events?.length);
  console.log(JSON.stringify(canonicalRes.body.events?.[0], null, 2));
}
main();
