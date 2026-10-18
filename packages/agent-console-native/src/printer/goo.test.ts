import { describe, expect, it } from "vitest";
import { alphaMask, cropToLit, decodeLayerImage, encodePng, layerDataLength, nextLayerOffset } from "./goo";

/** A minimal encoder for tests: black, white, and grey runs (the relay's tests use the same one). */
const encode = (runs: ReadonlyArray<readonly [value: number, count: number]>): Uint8Array => {
  const body: Array<number> = [];
  for (const [value, count] of runs) {
    const extra = count < 0x10 ? 0 : count < 0x1000 ? 1 : count < 0x100000 ? 2 : 3;
    const bytes = extra === 0 ? [] : extra === 1 ? [count >> 4] : extra === 2 ? [(count >> 12) & 0xff, (count >> 4) & 0xff] : [(count >> 20) & 0xff, (count >> 12) & 0xff, (count >> 4) & 0xff];
    const kind = value === 0 ? 0 : value === 0xff ? 3 : 1;
    body.push((kind << 6) | (extra << 4) | (count & 0x0f));
    if (kind === 1) body.push(value);
    body.push(...bytes);
  }
  const sum = body.reduce((acc, byte) => (acc + byte) & 0xff, 0);
  return Uint8Array.from([0x55, ...body, ~sum & 0xff]);
};

describe("decodeLayerImage", () => {
  it("decodes runs at full size", () => {
    const raster = decodeLayerImage(encode([[0, 3], [0xff, 2], [0x80, 3]]), 4, 2, 1);
    expect(Array.from(raster.pixels)).toEqual([0, 0, 0, 255, 255, 128, 128, 128]);
  });

  it("keeps the brightest pixel of each block when reducing", () => {
    const raster = decodeLayerImage(encode([[0, 5], [0xff, 1], [0, 10]]), 4, 4, 2);
    expect(Array.from(raster.pixels)).toEqual([255, 0, 0, 0]);
  });

  it("decodes long runs", () => {
    const raster = decodeLayerImage(encode([[0, 70000], [0xff, 5000], [0, 25000]]), 1000, 100, 10);
    expect(raster.pixels[700]).toBe(255);
    expect(raster.pixels[600]).toBe(0);
  });

  it("rejects a bad checksum", () => {
    const data = encode([[0, 8]]);
    data[data.length - 1] ^= 0xff;
    expect(() => decodeLayerImage(data, 4, 2, 1)).toThrow("checksum");
  });
});

describe("helpers", () => {
  it("crops to the lit area and masks it", () => {
    const raster = { width: 4, height: 3, channels: 1 as const, pixels: Uint8Array.from([0, 0, 0, 0, 0, 9, 7, 0, 0, 0, 0, 0]) };
    const cropped = cropToLit(raster);
    expect([cropped.width, cropped.height]).toEqual([4, 3]);
    const mask = alphaMask({ width: 2, height: 1, channels: 1, pixels: Uint8Array.from([9, 7]) }, true);
    expect(Array.from(mask.pixels)).toEqual([255, 7, 255, 9]);
  });

  it("reads the data length and next offset", () => {
    const definition = new Uint8Array(70);
    definition[64] = 0x0d;
    definition[65] = 0x0a;
    new DataView(definition.buffer).setUint32(66, 1000);
    expect(layerDataLength(definition)).toBe(1000);
    expect(nextLayerOffset(10, 1000)).toBe(10 + 70 + 1000 + 2);
  });

  it("writes a PNG signature", () => {
    const png = encodePng({ width: 1, height: 1, channels: 2, pixels: Uint8Array.from([255, 128]) });
    expect(Array.from(png.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  });
});
