import { beforeEach, describe, expect, it, vi } from "vitest";

/** The device's files, by name, and what the relay answers, by URL. */
const disk = new Map<string, Uint8Array>();
const served = new Map<string, Uint8Array>();

vi.mock("react-native", () => ({
  AppState: { currentState: "active", addEventListener: () => ({ remove: () => undefined }) },
}));

vi.mock("../auth/serverTokens", () => ({
  authHeaders: () => ({}),
  authedFetch: () => Promise.reject(new Error("not in this test")),
}));

vi.mock("expo-file-system", () => {
  class Directory {
    readonly exists = true;
    create(): void {}
    list(): ReadonlyArray<File> {
      return Array.from(disk.keys()).map((name) => new File(name));
    }
  }
  class File {
    readonly name: string;
    readonly modificationTime = 0;
    constructor(...parts: Array<unknown>) {
      this.name = String(parts[parts.length - 1]);
    }
    get exists(): boolean {
      return disk.has(this.name);
    }
    get size(): number {
      return disk.get(this.name)?.length ?? 0;
    }
    delete(): void {
      disk.delete(this.name);
    }
    move(to: File): void {
      const bytes = disk.get(this.name);
      if (bytes !== undefined) disk.set(to.name, bytes);
      disk.delete(this.name);
    }
    textSync(): string {
      return new TextDecoder().decode(disk.get(this.name));
    }
    open(): { offset: number; readBytes: (length: number) => Uint8Array; close: () => void } {
      const bytes = disk.get(this.name) ?? new Uint8Array();
      const handle = {
        offset: 0,
        readBytes: (length: number): Uint8Array => {
          const out = bytes.slice(handle.offset, handle.offset + length);
          handle.offset += out.length;
          return out;
        },
        close: (): void => undefined,
      };
      return handle;
    }
    static downloadFileAsync(url: string, destination: File): Promise<File> {
      const bytes = served.get(url);
      if (bytes === undefined) return Promise.reject(new Error("offline"));
      disk.set(destination.name, bytes);
      return Promise.resolve(destination);
    }
  }
  return { Directory, File, Paths: { cache: "cache" } };
});

/** A pack as the relay writes it (saturn-uploader `LayerPacks.assemble`). */
const packOf = (layers: ReadonlyArray<Uint8Array>): Uint8Array => {
  const start = (5 + layers.length + 1) * 4;
  const total = layers.reduce((sum, layer) => sum + layer.length, start);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  out.set(new TextEncoder().encode("SLPK"), 0);
  view.setUint32(4, 1, true);
  view.setUint32(8, layers.length, true);
  view.setUint32(12, 945, true);
  view.setUint32(16, 529, true);
  layers.reduce((at, layer, index) => {
    view.setUint32((5 + index) * 4, at, true);
    out.set(layer, at);
    return at + layer.length;
  }, start);
  view.setUint32((5 + layers.length) * 4, total, true);
  return out;
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const url = "http://relay:5197/api/prints/task-1/layers.pack";

describe("layer pack on the device", () => {
  beforeEach(() => {
    disk.clear();
    served.clear();
  });

  it("waits while the relay builds the pack, then keeps it and reads single layers", async () => {
    const packs = await import("./layerPack");
    served.set(url, new TextEncoder().encode(JSON.stringify({ state: "building", done: 3, total: 10 })));
    packs.ensureLayerPack("http://relay:5197", "task-1");
    await vi.waitFor(() => expect(packs.layerPackState("task-1")).toEqual({ kind: "Building", done: 3, total: 10 }));
    expect(disk.size).toBe(0);

    // The app asks again by itself after 5 s; the owner opening the page asks at once.
    served.set(url, packOf([Uint8Array.of(1, 2, 3), Uint8Array.of(250)]));
    await settle();
    packs.ensureLayerPack("http://relay:5197", "task-1");
    await vi.waitFor(() => expect(packs.layerPackState("task-1")).toEqual({ kind: "Ready", layerCount: 2 }));
    expect(Array.from(disk.keys())).toEqual(["task-1.pack"]);
    expect(packs.layerPackUri("task-1", 0)).toBe(`data:image/png;base64,${btoa(String.fromCharCode(1, 2, 3))}`);
    expect(packs.layerPackUri("task-1", 1)).toBe(`data:image/png;base64,${btoa(String.fromCharCode(250))}`);
    expect(packs.layerPackUri("task-1", 2)).toBeUndefined();
  });
});
