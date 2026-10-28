/**
 * A print file's 3D model, kept on the device: the relay's `model.mesh`
 * (saturn-uploader `src/LayerMesh.ts`), the model with its supports as the
 * printer cures it, at two levels of detail. The low level is small and
 * comes first; the high level replaces it in place when it is here (both
 * share one frame, so the model does not move). The native viewer
 * (modules/model-viewer) reads the files itself.
 *
 * A model belongs to the current print (by task id) or to a file (by its
 * browser path, such as `/local/part.goo`).
 *
 * @internal
 */
import * as React from "react";
import type { File } from "expo-file-system";
import { makeDownloads, type DownloadState, type Downloads } from "./relayDownload";

const MESH_MAGIC = "SLMS";
/** The format this app reads. Version 1 files are mirrored, so the app deletes them and gets them again. */
export const MESH_VERSION = 2;
const FIXED_BYTES = 48;

/** The levels of detail, smallest first: the order the app gets them in. */
export const MODEL_LEVELS = ["low", "high"] as const;
export type ModelLevel = (typeof MODEL_LEVELS)[number];

/** Whose model: the current print, or a file. */
export type ModelSource = { readonly kind: "Print"; readonly taskId: string } | { readonly kind: "File"; readonly path: string };

/** A model file on the device. */
export interface PrintModel {
  readonly uri: string;
  readonly vertexCount: number;
  readonly triangleCount: number;
  readonly layerHeightMm: number;
  readonly layerCount: number;
}

const view = (bytes: Uint8Array): DataView => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

/** Reads the model's header. Undefined when the file is not a whole model. */
export const openModel = (file: File): PrintModel | undefined => {
  const handle = file.open();
  try {
    const head = handle.readBytes(FIXED_BYTES);
    if (head.length < FIXED_BYTES || String.fromCharCode(...head.subarray(0, 4)) !== MESH_MAGIC) return undefined;
    const fields = view(head);
    if (fields.getUint32(4, true) !== MESH_VERSION) return undefined;
    const vertexCount = fields.getUint32(8, true);
    const triangleCount = fields.getUint32(12, true);
    const positionBytes = vertexCount * 6;
    const expected = FIXED_BYTES + positionBytes + ((4 - (positionBytes % 4)) % 4) + triangleCount * 12;
    return file.size === expected
      ? { uri: file.uri, vertexCount, triangleCount, layerHeightMm: fields.getFloat32(40, true), layerCount: fields.getUint32(44, true) }
      : undefined;
  } finally {
    handle.close();
  }
};

/** The id a source's files have on the device and in the store. */
export const modelIdOf = (source: ModelSource): string => (source.kind === "Print" ? source.taskId : `file:${source.path}`);

const urlOf =
  (level: ModelLevel) =>
  (relayBase: string, id: string): string =>
    id.startsWith("file:")
      ? `${relayBase}/api/files/model.mesh?path=${encodeURIComponent(id.slice("file:".length))}&level=${level}`
      : `${relayBase}/api/prints/${encodeURIComponent(id)}/model.mesh?level=${level}`;

const stores: Readonly<Record<ModelLevel, Downloads<PrintModel>>> = {
  // Low levels are small (about 3 MB), so the device keeps many: every printer file can open at once.
  low: makeDownloads({ folder: "print-models", urlOf: urlOf("low"), extension: ".low.mesh", keep: 40, open: openModel }),
  high: makeDownloads({ folder: "print-models", urlOf: urlOf("high"), extension: ".high.mesh", keep: 4, open: openModel }),
};

/** Gets the low level of a source's model onto the device, then the high level. Safe to call often. */
export const ensurePrintModel = (relayBase: string, source: ModelSource, levels: ReadonlyArray<ModelLevel> = MODEL_LEVELS): void => {
  const id = modelIdOf(source);
  levels.forEach((level) => stores[level].ensure(relayBase, id));
};

/** One level of a model on this device: where its download stands, and the file once it is here. */
export interface LevelState {
  readonly state: DownloadState | undefined;
  readonly model: PrintModel | undefined;
}

/** One level of a source's model on this device, outside React. */
export const printModelLevel = (source: ModelSource, level: ModelLevel): LevelState => {
  const id = modelIdOf(source);
  return { state: stores[level].state(id), model: stores[level].opened(id) };
};

/** A source's model on this device, by level, and the finest one here. Starts the downloads. */
export const usePrintModel = (
  relayBase: string | undefined,
  source: ModelSource | undefined,
): { readonly levels: Readonly<Record<ModelLevel, LevelState>>; readonly best: PrintModel | undefined; readonly bestLevel: ModelLevel | undefined } => {
  const [, setVersion] = React.useState(0);
  React.useEffect(() => {
    const stops = MODEL_LEVELS.map((level) => stores[level].subscribe(() => setVersion((version) => version + 1)));
    return () => stops.forEach((stop) => stop());
  }, []);
  const id = source === undefined ? undefined : modelIdOf(source);
  React.useEffect(() => {
    if (relayBase === undefined || id === undefined) return;
    MODEL_LEVELS.forEach((level) => stores[level].ensure(relayBase, id));
  }, [relayBase, id]);
  const levelOf = (level: ModelLevel): LevelState => ({
    state: id === undefined ? undefined : stores[level].state(id),
    model: id === undefined ? undefined : stores[level].opened(id),
  });
  const levels = { low: levelOf("low"), high: levelOf("high") };
  const bestLevel = levels.high.model !== undefined ? "high" : levels.low.model !== undefined ? "low" : undefined;
  return { levels, best: bestLevel === undefined ? undefined : levels[bestLevel].model, bestLevel };
};
