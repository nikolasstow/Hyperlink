import { beforeEach, describe, expect, it, vi } from "vitest";
import { MESH_VERSION } from "./printModel";

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
    get uri(): string {
      return `file:///cache/${this.name}`;
    }
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

/** A model as the relay writes it (saturn-uploader `LayerMesh.encode`): one triangle. */
const modelOf = (): Uint8Array => {
  const vertexCount = 3;
  const triangleCount = 1;
  const positionBytes = vertexCount * 6;
  const indexStart = 48 + positionBytes + ((4 - (positionBytes % 4)) % 4);
  const out = new Uint8Array(indexStart + triangleCount * 12);
  const view = new DataView(out.buffer);
  out.set(new TextEncoder().encode("SLMS"), 0);
  view.setUint32(4, MESH_VERSION, true);
  view.setUint32(8, vertexCount, true);
  view.setUint32(12, triangleCount, true);
  [0, 1, 2].forEach((index) => view.setUint32(indexStart + index * 4, index, true));
  return out;
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const lowUrl = "http://relay:5197/api/prints/task-1/model.mesh?level=low";
const fileUrl = "http://relay:5197/api/files/model.mesh?path=%2Flocal%2Fpart.goo&level=high";

describe("3D model on the device", () => {
  beforeEach(() => {
    disk.clear();
    served.clear();
  });

  it("waits while the relay builds a level, then keeps it", async () => {
    const { ensurePrintModel, printModelLevel } = await import("./printModel");
    const source = { kind: "Print", taskId: "task-1" } as const;
    served.set(lowUrl, new TextEncoder().encode(JSON.stringify({ state: "building", done: 40, total: 3400 })));
    ensurePrintModel("http://relay:5197", source, ["low"]);
    await vi.waitFor(() => expect(printModelLevel(source, "low").state).toEqual({ kind: "Building", done: 40, total: 3400 }));
    expect(disk.size).toBe(0);

    served.set(lowUrl, modelOf());
    await settle();
    ensurePrintModel("http://relay:5197", source, ["low"]);
    await vi.waitFor(() => expect(printModelLevel(source, "low").state).toEqual({ kind: "Ready" }));
    expect(printModelLevel(source, "low").model).toMatchObject({ uri: "file:///cache/task-1.low.mesh", vertexCount: 3, triangleCount: 1 });
  });

  it("gets a file's model by its path", async () => {
    const { ensurePrintModel, printModelLevel } = await import("./printModel");
    const source = { kind: "File", path: "/local/part.goo" } as const;
    served.set(fileUrl, modelOf());
    ensurePrintModel("http://relay:5197", source, ["high"]);
    await vi.waitFor(() => expect(printModelLevel(source, "high").model?.triangleCount).toBe(1));
  });

  it("does not take a cut-off model", async () => {
    const { openModel } = await import("./printModel");
    const { File } = await import("expo-file-system");
    disk.set("short.mesh", modelOf().subarray(0, 60));
    expect(openModel(new File("short.mesh"))).toBeUndefined();
    disk.set("whole.mesh", modelOf());
    expect(openModel(new File("whole.mesh"))?.triangleCount).toBe(1);
  });
});
