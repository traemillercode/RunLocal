// Generates Run Local PNG icons (192, 180, 512) with zero dependencies:
// a rounded-square brand tile with a white runner glyph, rendered to RGBA
// and encoded as PNG using node:zlib (IDAT) and a hand-rolled CRC32.
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "icons");
mkdirSync(outDir, { recursive: true });

// ---------- PNG encoding ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

// ---------- Drawing helpers (normalized 0..1 coordinates) ----------
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const len = (x, y) => Math.sqrt(x * x + y * y);

// Signed distance to a rounded rect centered at origin.
function roundedRectDist(x, y, half, r) {
  const qx = Math.abs(x) - (half - r);
  const qy = Math.abs(y) - (half - r);
  const ox = Math.max(qx, 0);
  const oy = Math.max(qy, 0);
  return Math.min(Math.max(qx, qy), 0) + Math.sqrt(ox * ox + oy * oy) - r;
}

// Signed distance to a capsule (line segment with rounded ends).
function capsuleDist(px, py, ax, ay, bx, by, r) {
  const pax = px - ax, pay = py - ay;
  const bax = bx - ax, bay = by - ay;
  const h = clamp((pax * bax + pay * bay) / (bax * bax + bay * bay), 0, 1);
  const dx = pax - bax * h, dy = pay - bay * h;
  return len(dx, dy) - r;
}

// Canonical Run Local orange brand; keep this aligned with public/favicon.svg.
const BRAND_TOP = [255, 87, 65]; // #ff5741
const BRAND_BOTTOM = [255, 154, 127]; // #ff9a7f
const VOLT = [255, 255, 255]; // white accent
const WHITE = [255, 255, 255];

function drawIcon(size) {
  const buf = Buffer.alloc(size * size * 4);
  const half = size / 2;
  const corner = 0.2 * size; // rounded-corner radius
  const pad = 0.06 * size; // glyph margin inside the tile

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const x = px + 0.5 - half;
      const y = py + 0.5 - half;
      const nx = x / size;
      const ny = y / size;
      const i = (py * size + px) * 4;

      const tile = roundedRectDist(nx, ny, 0.5, corner / size);
      let r = 0, g = 0, b = 0, a = 0;

      if (tile <= 0) {
        const t = clamp((ny + 0.5) / 1, 0, 1);
        r = BRAND_TOP[0] + (BRAND_BOTTOM[0] - BRAND_TOP[0]) * t;
        g = BRAND_TOP[1] + (BRAND_BOTTOM[1] - BRAND_TOP[1]) * t;
        b = BRAND_TOP[2] + (BRAND_BOTTOM[2] - BRAND_TOP[2]) * t;
        a = 255;

        // glyph (head + running pose strokes), in normalized tile units
        const gx = nx, gy = ny;
        let d = Infinity;
        // head
        d = Math.min(d, len(gx - 0.40, gy - 0.30) - 0.085);
        // torso
        d = Math.min(d, capsuleDist(gx, gy, 0.40, 0.40, 0.51, 0.62, 0.075));
        // back leg (extended back)
        d = Math.min(d, capsuleDist(gx, gy, 0.51, 0.62, 0.36, 0.80, 0.07));
        // front leg (bent forward)
        d = Math.min(d, capsuleDist(gx, gy, 0.51, 0.62, 0.66, 0.78, 0.07));
        // arm (forward swing)
        d = Math.min(d, capsuleDist(gx, gy, 0.44, 0.42, 0.68, 0.34, 0.06));

        if (d <= 0) {
          // AA edge
          const aa = clamp(-d / (2 / size), 0, 1);
          r = r + (WHITE[0] - r) * aa;
          g = g + (WHITE[1] - g) * aa;
          b = b + (WHITE[2] - b) * aa;
        }

        // volt accent dot (upper right)
        const dot = len(gx - 0.72, gy - 0.24) - 0.045;
        if (dot <= 0) {
          const aa = clamp(-dot / (2 / size), 0, 1);
          r = r + (VOLT[0] - r) * aa;
          g = g + (VOLT[1] - g) * aa;
          b = b + (VOLT[2] - b) * aa;
        }
      }

      buf[i] = r;
      buf[i + 1] = g;
      buf[i + 2] = b;
      buf[i + 3] = a;
    }
  }
  return encodePng(size, size, buf);
}

const targets = [
  [512, "icon-512.png"],
  [192, "icon-192.png"],
  [180, "icon-180.png"], // apple-touch-icon
];

for (const [size, name] of targets) {
  writeFileSync(join(outDir, name), drawIcon(size));
  console.log(`wrote public/icons/${name}`);
}
