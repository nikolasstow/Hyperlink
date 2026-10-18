/**
 * Layer images read straight from the printer, decoded on the phone: the
 * fallback for when the page is on the printer's LAN but the relay (which
 * normally draws them, with its offset tables already walked) cannot be
 * reached. Like the relay's, each image is the whole LCD with square
 * pixels, so it shows at one scale in real proportions.
 *
 * The printer has no layer offset table, so the first look at a print walks
 * the 70-byte layer definitions from the first layer (one small request per
 * layer). The walked table is kept in AsyncStorage per file, so that happens
 * once per print, not once per visit. After that each layer costs one read of
 * about 150 KB.
 *
 * The printer's file server is slow (about 100 KB/s) and serves one request
 * at a time well, so every read here goes through one queue.
 *
 * @internal
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as React from "react";
import { alphaMask, bigPreview, decodeLayerImage, encodePng, HEADER_SIZE, LAYER_DEFINITION_SIZE, LAYER_SEPARATOR_SIZE, layerDataLength, nextLayerOffset, parseHeader, pixelAspect, pngDataUri, stretchY, type GooHeader } from "./goo";

/** Where the mainboard keeps `/local/` and `/usb/` files on its HTTP file server. */
const STORAGE_PATHS = ["/media/mmcblk0p3/", "/media/sda1/"];

/** Reduction for the phone: 15120 x 6230 becomes 1512 x 623, then 1512 x 846 with square pixels. */
const SCALE = 10;
const SAVE_EVERY = 200;
const RENDER_CACHE = 12;

interface OpenFile {
  readonly url: string;
  readonly size: number;
  readonly header: GooHeader;
  readonly previewUri: string;
  /** `offsets[i]` is where layer i's definition starts. Grows as layers are walked. */
  readonly offsets: Array<number>;
  savedCount: number;
}

/** Progress of the one-time walk over the layer definitions. */
export interface IndexProgress {
  readonly indexed: number;
  readonly target: number;
}

const files = new Map<string, Promise<OpenFile>>();
const renders = new Map<string, string>();
let queue: Promise<unknown> = Promise.resolve();

/** The layer the page shows now, or `undefined` while no page shows one. */
let interest: { readonly taskId: string; readonly index: number } | undefined;

/** Only the shown layer and the next one are worth a read; the print has moved past the rest. */
const wanted = (taskId: string, index: number): boolean => interest !== undefined && interest.taskId === taskId && (index === interest.index || index === interest.index + 1);

/** A queued read that was dropped because the page no longer wants its layer. */
class Unwanted extends Error {
  constructor() {
    super("The page moved on from this layer");
  }
}

/** Runs `task` after every read already queued, so the printer serves one request at a time. */
const enqueue = <A>(task: () => Promise<A>): Promise<A> => {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
};

const rangeRead = async (url: string, offset: number, length: number): Promise<{ readonly bytes: Uint8Array; readonly total: number | undefined }> => {
  const response = await fetch(url, { headers: { Range: `bytes=${offset}-${offset + length - 1}` } });
  if (response.status !== 206) throw new Error(`HTTP ${response.status} for ${url}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength !== length) throw new Error(`short read at ${offset}: ${bytes.byteLength} of ${length}`);
  const match = /\/(\d+)\s*$/.exec(response.headers.get("content-range") ?? "");
  return { bytes, total: match === null ? undefined : Number(match[1]) };
};

const offsetsKey = (filename: string, size: number): string => `agent-console-native:printer:offsets:${filename}:${size}`;

const loadOffsets = async (filename: string, size: number, first: number): Promise<Array<number>> => {
  const raw = await AsyncStorage.getItem(offsetsKey(filename, size)).catch(() => null);
  if (raw === null) return [first];
  try {
    const table = JSON.parse(raw) as Array<number>;
    // A table that does not start at this file's first layer belongs to another slice.
    return Array.isArray(table) && table[0] === first ? table : [first];
  } catch {
    return [first];
  }
};

const saveOffsets = (filename: string, file: OpenFile): void => {
  file.savedCount = file.offsets.length;
  void AsyncStorage.setItem(offsetsKey(filename, file.size), JSON.stringify(file.offsets)).catch(() => undefined);
};

const openFresh = async (base: string, filename: string): Promise<OpenFile> => {
  let lastError: unknown;
  for (const storage of STORAGE_PATHS) {
    const url = `${base}${storage}${encodeURIComponent(filename)}`;
    try {
      const { bytes, total } = await rangeRead(url, 0, HEADER_SIZE);
      if (total === undefined) throw new Error("no Content-Range");
      const header = parseHeader(bytes);
      const offsets = await loadOffsets(filename, total, header.layerDefinitionOffset);
      return { url, size: total, header, previewUri: pngDataUri(encodePng(bigPreview(bytes))), offsets, savedCount: offsets.length };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`${filename} not found on the printer`);
};

const open = (base: string, filename: string, taskId: string): Promise<OpenFile> => {
  const key = `${taskId}/${filename}`;
  const existing = files.get(key);
  if (existing !== undefined) return existing;
  const opened = enqueue(() => openFresh(base, filename));
  // Only the current print matters; drop older files.
  files.clear();
  files.set(key, opened);
  opened.catch(() => files.delete(key));
  return opened;
};

/**
 * Walks definitions until `offsets[index + 1]` is known (or the file ends), reporting progress.
 * Stops with `Unwanted` when `still` turns false; the walked part is kept for the next request.
 */
const ensureOffsets = async (file: OpenFile, filename: string, index: number, still: () => boolean, onProgress: (progress: IndexProgress) => void): Promise<void> => {
  const target = Math.min(index + 1, file.header.layerCount - 1);
  while (file.offsets.length <= target) {
    if (!still()) {
      if (file.offsets.length > file.savedCount) saveOffsets(filename, file);
      throw new Unwanted();
    }
    const last = file.offsets[file.offsets.length - 1];
    const { bytes } = await rangeRead(file.url, last, LAYER_DEFINITION_SIZE);
    file.offsets.push(nextLayerOffset(last, layerDataLength(bytes)));
    if (file.offsets.length % 25 === 0) onProgress({ indexed: file.offsets.length, target: target + 1 });
    if (file.offsets.length - file.savedCount >= SAVE_EVERY) saveOffsets(filename, file);
  }
  if (file.offsets.length > file.savedCount) saveOffsets(filename, file);
};

const render = (base: string, filename: string, taskId: string, index: number, mirror: boolean, onProgress: (progress: IndexProgress) => void): Promise<string> => {
  const key = `${taskId}#${index}${mirror ? "m" : ""}`;
  const hit = renders.get(key);
  if (hit !== undefined) return Promise.resolve(hit);
  return open(base, filename, taskId).then((file) =>
    enqueue(async () => {
      const again = renders.get(key);
      if (again !== undefined) return again;
      const still = (): boolean => wanted(taskId, index);
      if (!still()) throw new Unwanted();
      await ensureOffsets(file, filename, index, still, onProgress);
      if (!still()) throw new Unwanted();
      const offset = file.offsets[index];
      const next = file.offsets[index + 1];
      const length = next !== undefined ? next - offset - LAYER_DEFINITION_SIZE - LAYER_SEPARATOR_SIZE : layerDataLength((await rangeRead(file.url, offset, LAYER_DEFINITION_SIZE)).bytes);
      const { bytes } = await rangeRead(file.url, offset + LAYER_DEFINITION_SIZE, length);
      const raster = decodeLayerImage(bytes, file.header.resolutionX, file.header.resolutionY, SCALE);
      const uri = pngDataUri(encodePng(alphaMask(stretchY(raster, pixelAspect(file.header)), mirror)));
      renders.set(key, uri);
      if (renders.size > RENDER_CACHE) renders.delete(renders.keys().next().value as string);
      return uri;
    }),
  );
};

export interface DirectLayer {
  readonly uri: string | undefined;
  /** The LCD's size in millimetres, from the print file. */
  readonly lcdMm: { readonly width: number; readonly height: number } | undefined;
  readonly previewUri: string | undefined;
  /** Set while the one-time layer index walk is running. */
  readonly progress: IndexProgress | undefined;
  readonly error: string | undefined;
}

/**
 * The current layer as an alpha-mask PNG `data:` URI, read from the printer
 * at `printerBase` (`http://<ip>:3030`). Pass `undefined` to turn it off,
 * for example while the page is on the relay.
 */
export const useDirectLayer = (target: { readonly printerBase: string; readonly filename: string; readonly taskId: string; readonly index: number; readonly totalLayers: number; readonly mirror: boolean } | undefined): DirectLayer => {
  const [uri, setUri] = React.useState<string | undefined>(undefined);
  const [previewUri, setPreviewUri] = React.useState<string | undefined>(undefined);
  const [lcdMm, setLcdMm] = React.useState<DirectLayer["lcdMm"]>(undefined);
  const [progress, setProgress] = React.useState<IndexProgress | undefined>(undefined);
  const [error, setError] = React.useState<string | undefined>(undefined);
  const base = target?.printerBase;
  const filename = target?.filename;
  const taskId = target?.taskId;
  const index = target?.index;
  const total = target?.totalLayers ?? 0;
  const mirror = target?.mirror ?? false;

  React.useEffect(() => {
    if (base === undefined || filename === undefined || taskId === undefined) return;
    let alive = true;
    void open(base, filename, taskId)
      .then((file) => {
        if (!alive) return;
        setPreviewUri(file.previewUri);
        if (file.header.displayWidthMm > 0 && file.header.displayHeightMm > 0) setLcdMm({ width: file.header.displayWidthMm, height: file.header.displayHeightMm });
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [base, filename, taskId]);

  React.useEffect(() => {
    if (base === undefined || filename === undefined || taskId === undefined || index === undefined) return;
    let alive = true;
    interest = { taskId, index };
    const onProgress = (next: IndexProgress): void => {
      if (alive) setProgress(next);
    };
    void render(base, filename, taskId, index, mirror, onProgress)
      .then((next) => {
        if (!alive) return;
        setUri(next);
        setProgress(undefined);
        setError(undefined);
        // Get the next layer ready while this one shows.
        if (index + 1 < total) void render(base, filename, taskId, index + 1, mirror, () => undefined).catch(() => undefined);
      })
      .catch((cause: unknown) => {
        if (alive && !(cause instanceof Unwanted)) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      alive = false;
      interest = undefined;
    };
  }, [base, filename, taskId, index, total, mirror]);

  return target === undefined ? { uri: undefined, lcdMm: undefined, previewUri: undefined, progress: undefined, error: undefined } : { uri, lcdMm, previewUri, progress, error };
};
