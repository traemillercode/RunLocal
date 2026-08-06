import { extname } from "node:path";

export const STATIC_TYPES: Record<string, string> = {
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
  ".jpg": "image/jpeg",
};

/** Resolve a missing route to the SPA document, including extensionless OAuth callbacks. */
export function resolveStaticPath(requestedPath: string, fallbackPath: string, requestedFileFound: boolean): string {
  return requestedFileFound ? requestedPath : fallbackPath;
}

export function staticHeaders(servedPath: string): Record<string, string> {
  const ext = extname(servedPath);
  return {
    "content-type": STATIC_TYPES[ext] ?? "application/octet-stream",
    "cache-control": ext === ".html" || ext === ".js" || ext === ".webmanifest" ? "no-cache" : "public, max-age=3600",
  };
}
