// Generates the Run Local PNG icons (512, 192, 180) with zero dependencies:
// a flat orange rounded-square brand tile with the canonical dark swoosh mark,
// matching public/favicon.svg (and the public site's brand-mark.svg) exactly.
// Rendered to RGBA and encoded as PNG using node:zlib (IDAT) + hand-rolled CRC32.
//
// Run directly (node scripts/gen-icons.mjs) to regenerate public/icons/.
// Exported renderIcon/drawIcon/writeIcons let tests verify the committed
// assets stay byte-identical to this canonical generator.
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const defaultOutDir = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "icons");

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

// ---------- Drawing helpers (normalized -0.5..0.5 coordinates) ----------
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

// Canonical Run Local brand — keep this aligned with public/favicon.svg and
// the public site's brand-mark.svg: a flat orange (#ff5741) rounded tile with
// the dark (#14171c) double-stroke swoosh.
const BRAND = [255, 87, 65]; // #ff5741
const MARK = [20, 23, 28]; // #14171c

// favicon.svg geometry, normalized to the icon's -0.5..0.5 space:
//   <rect width="64" height="64" rx="13" fill="#FF5741"/>
//   <path d="M13 32.5 36 19m-18 29 31-18" stroke="#14171C" stroke-width="8"/>
// Each endpoint is v/64 - 0.5; the capsule radius is stroke-width / 2.
const MARK_SEGMENTS = [
  { ax: 13 / 64 - 0.5, ay: 32.5 / 64 - 0.5, bx: 36 / 64 - 0.5, by: 19 / 64 - 0.5, r: 8 / 64 / 2 },
  { ax: 18 / 64 - 0.5, ay: 48 / 64 - 0.5, bx: 49 / 64 - 0.5, by: 30 / 64 - 0.5, r: 8 / 64 / 2 },
];

/** Render the canonical mark to an RGBA buffer of the given square size. */
export function renderIcon(size) {
  const buf = Buffer.alloc(size * size * 4);
  const half = size / 2;
  const corner = (13 / 64) * size; // favicon rounded-corner radius (rx=13 on 64)

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
        r = BRAND[0];
        g = BRAND[1];
        b = BRAND[2];
        a = 255;

        let d = Infinity;
        for (const seg of MARK_SEGMENTS) {
          d = Math.min(d, capsuleDist(nx, ny, seg.ax, seg.ay, seg.bx, seg.by, seg.r));
        }
        if (d <= 0) {
          // AA edge: blend toward the dark mark color.
          const aa = clamp(-d / (2 / size), 0, 1);
          r += (MARK[0] - r) * aa;
          g += (MARK[1] - g) * aa;
          b += (MARK[2] - b) * aa;
        }
      }

      buf[i] = r;
      buf[i + 1] = g;
      buf[i + 2] = b;
      buf[i + 3] = a;
    }
  }
  return buf;
}

/** Render the canonical mark and encode it as a PNG Buffer. */
export function drawIcon(size) {
  return encodePng(size, size, renderIcon(size));
}

const TARGETS = [
  [512, "icon-512.png"],
  [192, "icon-192.png"],
  [180, "icon-180.png"], // apple-touch-icon
];

/** Write all PNG icons (512/192/180) into outDir (default: public/icons). */
export function writeIcons(outDir = defaultOutDir) {
  mkdirSync(outDir, { recursive: true });
  for (const [size, name] of TARGETS) {
    writeFileSync(join(outDir, name), drawIcon(size));
    console.log(`wrote ${join(outDir, name)}`);
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) writeIcons();
