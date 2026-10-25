/**
 * The print's layer pack, kept on the device: every layer of the print in one
 * file from the relay (`GET /api/prints/<taskId>/layers.pack`), so the
 * scrubber shows any layer at once, with no request.
 *
 * The app downloads the pack once per print and keeps the last few packs in
 * the cache folder. While the relay builds a pack (about 40 s from its own
 * copy, longer from the printer), it answers 202 and the app asks again.
 *
 * The format is in saturn-uploader `src/LayerPacks.ts`: `SLPK`, the version,
 * the layer count, the image size, a table of where each PNG starts, then
 * the PNGs. Each PNG is white with the layer as alpha, as `alpha=1` layer
 * images are, so the LCD tints it the same way.
 *
 * @internal
 */
import * as React from "react";
import { AppState } from "react-native";
import { Directory, File, Paths } from "expo-file-system";
import { authedFetch, authHeaders } from "../auth/serverTokens";
import { pngDataUri } from "./goo";

const PACK_MAGIC = "SLPK";
const PACK_VERSION = 1;
const FIXED_FIELDS = 5;
/** How many packs the device keeps; the oldest go first. */
const KEEP = 3;
/** How long the app waits before it asks again while the relay builds the pack. */
const RETRY_MS = 5_000;
/** How long the app waits after a failed download or build. */
const FAILED_RETRY_MS = 60_000;
/** How often the open app checks the relay for a new print. */
const WATCH_MS = 120_000;

/** Where a print's pack stands on this device. */
export type PackState =
  | { readonly kind: "Building"; readonly done: number; readonly total: number }
  | { readonly kind: "Downloading" }
  | { readonly kind: "Ready"; readonly layerCount: number }
  | { readonly kind: "Failed"; readonly reason: string };

/** An open pack: its table, and the file it reads each layer from. */
interface OpenPack {
  readonly layerCount: number;
  readonly starts: ReadonlyArray<number>;
  readonly file: File;
}

const folder = (): Directory => new Directory(Paths.cache, "layer-packs");

const fileOf = (taskId: string): File => new File(folder(), `${taskId.replace(/[^A-Za-z0-9._-]/g, "_")}.pack`);

const states = new Map<string, PackState>();
const opened = new Map<string, OpenPack>();
const listeners = new Set<() => void>();
const working = new Set<string>();

const setState = (taskId: string, state: PackState): void => {
  states.set(taskId, state);
  listeners.forEach((listener) => listener());
};

const u32 = (bytes: Uint8Array, at: number): number => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(at, true);

/** Reads the pack's table. Undefined when the file is not a pack. */
const openPack = (file: File): OpenPack | undefined => {
  const handle = file.open();
  try {
    const head = handle.readBytes(FIXED_FIELDS * 4);
    if (head.length < FIXED_FIELDS * 4 || String.fromCharCode(...head.subarray(0, 4)) !== PACK_MAGIC || u32(head, 4) !== PACK_VERSION) return undefined;
    const layerCount = u32(head, 8);
    const table = handle.readBytes((layerCount + 1) * 4);
    const starts = Array.from({ length: layerCount + 1 }, (_, index) => u32(table, index * 4));
    return starts[layerCount] === file.size ? { layerCount, starts, file } : undefined;
  } finally {
    handle.close();
  }
};

/** Deletes all but the newest `KEEP` packs. */
const prune = (): void => {
  const packs = folder()
    .list()
    .filter((entry): entry is File => entry instanceof File && entry.name.endsWith(".pack"))
    .sort((a, b) => (b.modificationTime ?? 0) - (a.modificationTime ?? 0));
  packs.slice(KEEP).forEach((old) => old.delete());
};

/** The layer's PNG as a `data:` URI, read from the pack on the device. */
const layerUri = (pack: OpenPack, index: number): string | undefined => {
  const start = pack.starts[index];
  const end = pack.starts[index + 1];
  if (start === undefined || end === undefined || end <= start) return undefined;
  const handle = pack.file.open();
  try {
    handle.offset = start;
    return pngDataUri(handle.readBytes(end - start));
  } finally {
    handle.close();
  }
};

const decodeAnswer = (text: string): PackState => {
  try {
    const body: unknown = JSON.parse(text);
    if (typeof body === "object" && body !== null && "state" in body) {
      if (body.state === "building" && "done" in body && "total" in body && typeof body.done === "number" && typeof body.total === "number") {
        return { kind: "Building", done: body.done, total: body.total };
      }
      if (body.state === "failed" && "reason" in body && typeof body.reason === "string") return { kind: "Failed", reason: body.reason };
    }
    if (typeof body === "object" && body !== null && "error" in body && typeof body.error === "string") return { kind: "Failed", reason: body.error };
  } catch {
    // Not JSON: fall through.
  }
  return { kind: "Failed", reason: "The relay sent something that is not a layer pack" };
};

/**
 * Gets the pack for `taskId` onto the device, once. Asks again while the
 * relay builds it. Safe to call often: one download runs per print.
 */
export const ensureLayerPack = (relayBase: string, taskId: string): void => {
  if (working.has(taskId) || opened.has(taskId)) return;
  const target = fileOf(taskId);
  if (target.exists) {
    const pack = openPack(target);
    if (pack !== undefined) {
      opened.set(taskId, pack);
      setState(taskId, { kind: "Ready", layerCount: pack.layerCount });
      return;
    }
    target.delete();
  }
  working.add(taskId);
  const dir = folder();
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  const part = new File(dir, `${target.name}.part`);
  const url = `${relayBase}/api/prints/${encodeURIComponent(taskId)}/layers.pack`;
  const again = (ms: number): void => {
    setTimeout(() => ensureLayerPack(relayBase, taskId), ms);
  };
  setState(taskId, { kind: "Downloading" });
  File.downloadFileAsync(url, part, { idempotent: true, headers: authHeaders(url) })
    .then((downloaded) => {
      const pack = openPack(downloaded);
      if (pack === undefined) {
        // A 202 or a 503: a short JSON answer, not the pack.
        const answer = decodeAnswer(downloaded.textSync());
        downloaded.delete();
        setState(taskId, answer);
        again(answer.kind === "Building" ? RETRY_MS : FAILED_RETRY_MS);
        return;
      }
      if (target.exists) target.delete();
      downloaded.move(target);
      opened.set(taskId, { ...pack, file: target });
      setState(taskId, { kind: "Ready", layerCount: pack.layerCount });
      prune();
    })
    .catch((error: unknown) => {
      if (part.exists) part.delete();
      setState(taskId, { kind: "Failed", reason: error instanceof Error ? error.message : String(error) });
      again(FAILED_RETRY_MS);
    })
    .finally(() => working.delete(taskId));
};

/** Where the pack for `taskId` stands on this device. */
export const layerPackState = (taskId: string): PackState | undefined => states.get(taskId);

/** Layer `index` of the pack for `taskId` as a `data:` URI, when the pack is on the device. */
export const layerPackUri = (taskId: string, index: number): string | undefined => {
  const pack = opened.get(taskId);
  return pack === undefined ? undefined : layerUri(pack, index);
};

/**
 * The print's pack on this device: its state, and the layer at an index as an
 * image source. Starts the download when `relayBase` and `taskId` are known.
 */
export const useLayerPack = (
  relayBase: string | undefined,
  taskId: string | undefined,
): { readonly state: PackState | undefined; readonly uriOf: (index: number | undefined) => string | undefined } => {
  const [, setVersion] = React.useState(0);
  React.useEffect(() => {
    const listener = (): void => setVersion((version) => version + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  React.useEffect(() => {
    if (relayBase !== undefined && taskId !== undefined) ensureLayerPack(relayBase, taskId);
  }, [relayBase, taskId]);
  const pack = taskId === undefined ? undefined : opened.get(taskId);
  // The last few layers read, so a re-render does not read the file again.
  const cache = React.useRef(new Map<string, string>());
  const uriOf = React.useCallback(
    (index: number | undefined): string | undefined => {
      if (pack === undefined || index === undefined || taskId === undefined) return undefined;
      const key = `${taskId}#${index}`;
      const hit = cache.current.get(key);
      if (hit !== undefined) return hit;
      const uri = layerUri(pack, index);
      if (uri !== undefined) {
        cache.current.set(key, uri);
        if (cache.current.size > 24) cache.current.delete(cache.current.keys().next().value ?? key);
      }
      return uri;
    },
    [pack, taskId],
  );
  return { state: taskId === undefined ? undefined : states.get(taskId), uriOf };
};

const currentTaskId = (body: unknown): string | undefined =>
  typeof body === "object" && body !== null && "print" in body && typeof body.print === "object" && body.print !== null && "taskId" in body.print && typeof body.print.taskId === "string" && body.print.taskId !== ""
    ? body.print.taskId
    : undefined;

/**
 * Gets the current print's pack before the owner opens the printer page: at
 * app open, at each return to the foreground, and every 2 minutes while the
 * app is open. It reads the relay's `GET /api/state`, which the relay answers
 * from its cache, so it sends nothing to the printer. Returns the stop.
 */
export const watchForLayerPacks = (relayBase: string): (() => void) => {
  const check = (): void => {
    if (AppState.currentState !== "active") return;
    void authedFetch(`${relayBase}/api/state`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : undefined))
      .then((body: unknown) => {
        const taskId = currentTaskId(body);
        if (taskId !== undefined) ensureLayerPack(relayBase, taskId);
      })
      .catch(() => undefined);
  };
  check();
  const timer = setInterval(check, WATCH_MS);
  const subscription = AppState.addEventListener("change", (next) => {
    if (next === "active") check();
  });
  return () => {
    clearInterval(timer);
    subscription.remove();
  };
};
