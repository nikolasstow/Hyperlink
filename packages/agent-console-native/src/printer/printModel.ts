/**
 * The print's 3D model, kept on the device: the relay's
 * `GET /api/prints/<taskId>/model.mesh` (saturn-uploader `src/LayerMesh.ts`),
 * the model with its supports as the printer cures it. The native viewer
 * (modules/model-viewer) reads the file itself.
 *
 * @internal
 */
import * as React from "react";
import type { File } from "expo-file-system";
import { makeDownloads, type DownloadState } from "./relayDownload";

const MESH_MAGIC = "SLMS";
const MESH_VERSION = 1;
const FIXED_BYTES = 48;

/** A model file on the device. */
export interface PrintModel {
  readonly uri: string;
  readonly vertexCount: number;
  readonly triangleCount: number;
}

const u32 = (bytes: Uint8Array, at: number): number => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(at, true);

/** Reads the model's header. Undefined when the file is not a whole model. */
export const openModel = (file: File): PrintModel | undefined => {
  const handle = file.open();
  try {
    const head = handle.readBytes(FIXED_BYTES);
    if (head.length < FIXED_BYTES || String.fromCharCode(...head.subarray(0, 4)) !== MESH_MAGIC || u32(head, 4) !== MESH_VERSION) return undefined;
    const vertexCount = u32(head, 8);
    const triangleCount = u32(head, 12);
    const positionBytes = vertexCount * 6;
    const expected = FIXED_BYTES + positionBytes + ((4 - (positionBytes % 4)) % 4) + triangleCount * 12;
    return file.size === expected ? { uri: file.uri, vertexCount, triangleCount } : undefined;
  } finally {
    handle.close();
  }
};

export const printModels = makeDownloads({
  folder: "print-models",
  route: "model.mesh",
  extension: ".mesh",
  keep: 3,
  open: openModel,
});

/** The print's model on this device: where its download stands, and the file once it is here. Starts the download. */
export const usePrintModel = (
  relayBase: string | undefined,
  taskId: string | undefined,
): { readonly state: DownloadState | undefined; readonly model: PrintModel | undefined } => {
  const [, setVersion] = React.useState(0);
  React.useEffect(() => printModels.subscribe(() => setVersion((version) => version + 1)), []);
  React.useEffect(() => {
    if (relayBase !== undefined && taskId !== undefined) printModels.ensure(relayBase, taskId);
  }, [relayBase, taskId]);
  return {
    state: taskId === undefined ? undefined : printModels.state(taskId),
    model: taskId === undefined ? undefined : printModels.opened(taskId),
  };
};
