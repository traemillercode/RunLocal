import type { Buffer } from "node:buffer";

export const MAX_IMAGE_EDGE = 4096;

export function imageDimensions(bytes: Buffer, ext: "jpg" | "png" | "webp"): { width: number; height: number } | null {
  if (ext === "png") {
    if (bytes.length < 24 || !bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) || bytes.readUInt32BE(8) !== 13 || bytes.toString("ascii", 12, 16) !== "IHDR") return null;
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (ext === "webp") {
    if (bytes.length < 16 || bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WEBP") return null;
    if (bytes.toString("ascii", 12, 16) === "VP8X") {
      if (bytes.length < 30) return null;
      return { width: 1 + bytes.readUIntLE(24, 3), height: 1 + bytes.readUIntLE(27, 3) };
    }
    if (bytes.toString("ascii", 12, 16) === "VP8L" && bytes.length >= 25 && bytes[20] === 0x2f) {
      return { width: 1 + (((bytes[21] | (bytes[22] << 8)) & 0x3fff)), height: 1 + ((((bytes[22] >> 6) | (bytes[23] << 2) | ((bytes[24] & 0x3f) << 10)) & 0x3fff)) };
    }
    return null;
  }
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let p = 2;
  while (p + 4 <= bytes.length) {
    if (bytes[p] !== 0xff) { p++; continue; }
    while (p < bytes.length && bytes[p] === 0xff) p++;
    const marker = bytes[p++];
    if (marker === 0xd8) continue;
    if (marker === 0xd9) return null;
    if (p + 2 > bytes.length) return null;
    const length = bytes.readUInt16BE(p);
    if (length < 2 || p + length > bytes.length) return null;
    if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
      if (length < 7) return null;
      return { width: bytes.readUInt16BE(p + 5), height: bytes.readUInt16BE(p + 3) };
    }
    p += length;
  }
  return null;
}

export function validateImageBytes(bytes: Buffer, ext: "jpg" | "png" | "webp", minEdge: number, maxBytes = 4 * 1024 * 1024): string | null {
  if (bytes.length === 0) return "invalid_image";
  if (bytes.length > maxBytes) return "image_too_large";
  const d = imageDimensions(bytes, ext);
  if (!d) return "invalid_image";
  if (d.width < minEdge || d.height < minEdge) return "image_too_small";
  if (d.width > MAX_IMAGE_EDGE || d.height > MAX_IMAGE_EDGE) return "image_dimensions_too_large";
  return null;
}
