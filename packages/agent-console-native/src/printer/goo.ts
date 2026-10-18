/**
 * Elegoo `.goo` slice files, decoded on the phone: the header, the layer
 * definitions, and the layer image run-length code, plus a small PNG writer.
 *
 * This is how the page shows the layer without the relay when the phone is
 * on the printer's LAN. The printer's own HTTP file server (port 3030) serves
 * the print file with `Range` support, so the page reads only the bytes it
 * needs. The same decoder runs in the relay (saturn-uploader `src/Goo.ts`);
 * the layout comes from UVtools and was checked against a real print file.
 * All numbers are big-endian.
 *
 * @internal
 */
import { zlibSync } from "fflate";

export const HEADER_SIZE = 195477;
export const LAYER_DEFINITION_SIZE = 70;
export const LAYER_SEPARATOR_SIZE = 2;

const FILE_MAGIC = [0x07, 0x00, 0x00, 0x00, 0x44, 0x4c, 0x50, 0x00];
const BIG_PREVIEW_OFFSET = 27108;
const BIG_PREVIEW_SIZE = 290;

export interface GooHeader {
  readonly layerCount: number;
  readonly resolutionX: number;
  readonly resolutionY: number;
  readonly mirrorX: boolean;
  /** The LCD's size. 16K pixels are not square, so this, not the resolution, gives its shape. */
  readonly displayWidthMm: number;
  readonly displayHeightMm: number;
  readonly layerHeightMm: number;
  readonly exposureSeconds: number;
  readonly bottomExposureSeconds: number;
  readonly bottomLayerCount: number;
  readonly layerDefinitionOffset: number;
}

/** An 8-bit image, rows top to bottom: 1 byte per pixel (grey), 2 (grey + alpha), or 3 (RGB). */
export interface Raster {
  readonly width: number;
  readonly height: number;
  readonly channels: 1 | 2 | 3;
  readonly pixels: Uint8Array;
}

const view = (bytes: Uint8Array): DataView => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

export const parseHeader = (bytes: Uint8Array): GooHeader => {
  if (bytes.byteLength < HEADER_SIZE) throw new Error(`header needs ${HEADER_SIZE} bytes, got ${bytes.byteLength}`);
  if (FILE_MAGIC.some((byte, i) => bytes[4 + i] !== byte)) throw new Error("not a .goo file");
  const v = view(bytes);
  return {
    layerCount: v.getUint32(195310),
    resolutionX: v.getUint16(195314),
    resolutionY: v.getUint16(195316),
    mirrorX: v.getUint8(195318) !== 0,
    displayWidthMm: Math.round(v.getFloat32(195320) * 10000) / 10000,
    displayHeightMm: Math.round(v.getFloat32(195324) * 10000) / 10000,
    layerHeightMm: Math.round(v.getFloat32(195332) * 10000) / 10000,
    exposureSeconds: Math.round(v.getFloat32(195336) * 10000) / 10000,
    bottomExposureSeconds: Math.round(v.getFloat32(195369) * 10000) / 10000,
    bottomLayerCount: v.getUint32(195373),
    layerDefinitionOffset: v.getUint32(195470),
  };
};

/** The encoded image length from a layer definition (70 bytes). */
export const layerDataLength = (definition: Uint8Array): number => {
  if (definition.byteLength < LAYER_DEFINITION_SIZE || definition[64] !== 0x0d || definition[65] !== 0x0a) throw new Error("layer definition separator missing (wrong offset?)");
  return view(definition).getUint32(66);
};

export const nextLayerOffset = (offset: number, dataLength: number): number => offset + LAYER_DEFINITION_SIZE + dataLength + LAYER_SEPARATOR_SIZE;

/** The slicer's 290 x 290 RGB565 preview from the header bytes. */
export const bigPreview = (header: Uint8Array): Raster => {
  const v = view(header);
  const size = BIG_PREVIEW_SIZE;
  const pixels = new Uint8Array(size * size * 3);
  for (let i = 0; i < size * size; i++) {
    const c = v.getUint16(BIG_PREVIEW_OFFSET + i * 2);
    pixels[i * 3] = (((c >> 11) & 31) * 255) / 31;
    pixels[i * 3 + 1] = (((c >> 5) & 63) * 255) / 63;
    pixels[i * 3 + 2] = ((c & 31) * 255) / 31;
  }
  return { width: size, height: size, channels: 3, pixels };
};

/**
 * Decodes an encoded layer image into a reduced grey raster. Each output
 * pixel is the brightest of the `scale x scale` block it covers, so thin
 * features stay visible. It never builds the 94-megapixel full frame.
 *
 * The top two bits of each chunk's first byte give its kind: `00` black run,
 * `11` white run, `01` grey run (value byte follows), `10` a small change to
 * the current value. The last byte is a checksum.
 */
export const decodeLayerImage = (data: Uint8Array, resolutionX: number, resolutionY: number, scale: number): Raster => {
  const width = resolutionX;
  if (data.byteLength < 2 || data[0] !== 0x55) throw new Error("layer image does not start with 0x55");
  const last = data.byteLength - 1;
  let sum = 0;
  for (let i = 1; i < last; i++) sum = (sum + data[i]) & 0xff;
  if ((~sum & 0xff) !== data[last]) throw new Error("layer image checksum does not match");
  const outWidth = Math.ceil(width / scale);
  const outHeight = Math.ceil(resolutionY / scale);
  const out = new Uint8Array(outWidth * outHeight);
  const total = width * resolutionY;
  let pixel = 0;
  let color = 0;
  let i = 1;
  while (i < last) {
    const head = data[i];
    const kind = head >> 6;
    let count: number;
    if (kind === 2) {
      const delta = head & 0x0f;
      const mode = (head >> 4) & 3;
      color = (mode < 2 ? color + delta : color - delta) & 0xff;
      if ((mode & 1) === 1) {
        count = data[i + 1];
        i += 2;
      } else {
        count = 1;
        i += 1;
      }
    } else {
      if (kind === 0) color = 0;
      else if (kind === 3) color = 0xff;
      else {
        i += 1;
        color = data[i];
      }
      const low = head & 0x0f;
      const extra = (head >> 4) & 3;
      count = extra === 0 ? low : extra === 1 ? (data[i + 1] << 4) | low : extra === 2 ? (data[i + 1] << 12) | (data[i + 2] << 4) | low : (data[i + 1] << 20) | (data[i + 2] << 12) | (data[i + 3] << 4) | low;
      i += 1 + extra;
    }
    if (pixel + count > total) throw new Error("layer image runs past the frame");
    if (color !== 0) {
      const end = pixel + count;
      let p = pixel;
      while (p < end) {
        const y = Math.floor(p / width);
        const rowStart = y * width;
        const x1 = Math.min(end - rowStart, width);
        const outRow = Math.floor(y / scale) * outWidth;
        const lastOut = Math.floor((x1 - 1) / scale);
        for (let ox = Math.floor((p - rowStart) / scale); ox <= lastOut; ox++) {
          if (out[outRow + ox] < color) out[outRow + ox] = color;
        }
        p = rowStart + x1;
      }
    }
    pixel += count;
  }
  if (pixel !== total) throw new Error(`layer image covers ${pixel} of ${total} pixels`);
  return { width: outWidth, height: outHeight, channels: 1, pixels: out };
};

/** The lit area plus a 3% margin, clipped to the raster; the whole raster for a blank layer. */
export const cropToLit = (raster: Raster): Raster => {
  let minX = raster.width;
  let minY = raster.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < raster.height; y++) {
    const row = y * raster.width;
    for (let x = 0; x < raster.width; x++) {
      if (raster.pixels[row + x] !== 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return raster;
  const margin = Math.ceil(Math.max(maxX - minX, maxY - minY) * 0.03);
  const x0 = Math.max(0, minX - margin);
  const y0 = Math.max(0, minY - margin);
  const x1 = Math.min(raster.width, maxX + 1 + margin);
  const y1 = Math.min(raster.height, maxY + 1 + margin);
  const width = x1 - x0;
  const height = y1 - y0;
  const pixels = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) pixels.set(raster.pixels.subarray((y0 + y) * raster.width + x0, (y0 + y) * raster.width + x1), y * width);
  return { width, height, channels: 1, pixels };
};

/** How much taller each LCD pixel is than wide (about 1.36 on a Saturn 4 Ultra 16K: 14 x 19 micrometres). */
export const pixelAspect = (header: Pick<GooHeader, "displayWidthMm" | "displayHeightMm" | "resolutionX" | "resolutionY">): number =>
  header.displayWidthMm > 0 && header.displayHeightMm > 0 && header.resolutionX > 0 && header.resolutionY > 0
    ? header.displayHeightMm / header.resolutionY / (header.displayWidthMm / header.resolutionX)
    : 1;

/** Stretches a one-channel raster vertically by `factor` (blending neighbouring rows), so its pixels come out square. */
export const stretchY = (raster: Raster, factor: number): Raster => {
  if (Math.abs(factor - 1) < 0.001) return raster;
  const height = Math.max(1, Math.round(raster.height * factor));
  const pixels = new Uint8Array(raster.width * height);
  for (let y = 0; y < height; y++) {
    const source = Math.max(0, Math.min(raster.height - 1, (y + 0.5) / factor - 0.5));
    const a = Math.floor(source);
    const b = Math.min(raster.height - 1, a + 1);
    const t = source - a;
    for (let x = 0; x < raster.width; x++) {
      const top = raster.pixels[a * raster.width + x];
      pixels[y * raster.width + x] = Math.round(top + (raster.pixels[b * raster.width + x] - top) * t);
    }
  }
  return { width: raster.width, height, channels: 1, pixels };
};

/** White with the grey value as alpha, optionally flipped left to right (as on the LCD for `mirrorX` files). */
export const alphaMask = (raster: Raster, mirror: boolean): Raster => {
  const pixels = new Uint8Array(raster.width * raster.height * 2);
  for (let y = 0; y < raster.height; y++) {
    for (let x = 0; x < raster.width; x++) {
      const to = (y * raster.width + (mirror ? raster.width - 1 - x : x)) * 2;
      pixels[to] = 255;
      pixels[to + 1] = raster.pixels[y * raster.width + x];
    }
  }
  return { width: raster.width, height: raster.height, channels: 2, pixels };
};

// ---------------------------------------------------------------------------
// PNG
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) === 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

const crc32 = (bytes: Uint8Array): number => {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const chunk = (type: string, data: Uint8Array): Uint8Array => {
  const out = new Uint8Array(12 + data.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  v.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
};

export const encodePng = (raster: Raster): Uint8Array => {
  const header = new Uint8Array(13);
  const v = new DataView(header.buffer);
  v.setUint32(0, raster.width);
  v.setUint32(4, raster.height);
  header[8] = 8;
  header[9] = raster.channels === 1 ? 0 : raster.channels === 2 ? 4 : 2;
  const stride = raster.width * raster.channels;
  const rows = new Uint8Array(raster.height * (stride + 1));
  for (let y = 0; y < raster.height; y++) rows.set(raster.pixels.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  const parts = [Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10), chunk("IHDR", header), chunk("IDAT", zlibSync(rows, { level: 6 })), chunk("IEND", new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};

/** A `data:` URI for an `Image` source. */
export const pngDataUri = (png: Uint8Array): string => {
  let binary = "";
  for (let i = 0; i < png.length; i += 0x8000) binary += String.fromCharCode(...png.subarray(i, i + 0x8000));
  return `data:image/png;base64,${btoa(binary)}`;
};
