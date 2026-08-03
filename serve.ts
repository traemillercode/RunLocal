// Minimal static server for the built SPA — serves dist/ with a
// single-origin SPA fallback on 0.0.0.0:3000. Zero dependencies.
// NOTE: we deliberately avoid the generic PORT env var — sandboxes often set
// PORT=80 globally, which would steal the team's fixed public port (3000).
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const root = normalize(process.env.RUN_LOCAL_ROOT ?? join(import.meta.dirname, "dist"));
const port = Number(process.env.RUN_LOCAL_PORT ?? 3000);

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json",
  ".json": "application/json",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === "/") pathname = "/index.html";

    const filePath = normalize(join(root, pathname));
    if (!filePath.startsWith(root)) {
      res.writeHead(403).end();
      return;
    }

    let data: Buffer;
    try {
      data = await readFile(filePath);
    } catch {
      // SPA fallback: unknown paths render the shell (hash router owns routing)
      data = await readFile(join(root, "index.html"));
    }

    const ext = extname(filePath);
    res.writeHead(200, {
      "content-type": TYPES[ext] ?? "application/octet-stream",
      "cache-control": ext === ".html" ? "no-cache" : "public, max-age=3600",
    });
    res.end(data);
  } catch {
    res.writeHead(500).end("server error");
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Run Local serving ${root} on http://0.0.0.0:${port}`);
});
