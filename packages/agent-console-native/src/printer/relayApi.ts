/**
 * The relay's HTTP API, as the printer page uses it: the print file's header,
 * the printer's files (with previews and details), and uploads to the
 * printer through the relay (saturn-uploader `relay`).
 *
 * Uploads never start a print. While a print runs, the relay paces them so the
 * printer is not disturbed, and it refuses to replace the file being printed.
 *
 * @internal
 */
import { File, UploadTask } from "expo-file-system";
import { authedFetch } from "../auth/serverTokens";

/** A `.goo` file's header, as the relay reports it. */
export interface PrintHeader {
  readonly displayWidthMm: number;
  readonly displayHeightMm: number;
  readonly layerHeightMm: number;
  readonly layerCount: number;
  readonly exposureSeconds: number;
  readonly bottomExposureSeconds: number;
  readonly bottomLayerCount: number;
  readonly transitionLayerCount: number;
  readonly antiAliasing: number;
  readonly volumeMl: number;
  readonly materialGrams: number;
  readonly printSeconds: number;
  readonly softwareName: string;
  readonly softwareVersion: string;
  readonly createdAt: string;
}

/** One row of the file browser. */
export interface FileView {
  readonly name: string;
  readonly path: string;
  readonly kind: "file" | "folder";
  readonly size?: number;
  readonly printable: boolean;
  readonly printing: boolean;
}

export interface FileList {
  readonly path: string;
  readonly storage: "local" | "usb";
  readonly parent: string | null;
  readonly entries: ReadonlyArray<FileView>;
}

export type UploadStage = "queued" | "hashing" | "sending" | "verifying" | "done" | "failed" | "cancelled";

/** An upload as the relay tracks it, after it has the whole file. */
export interface UploadJob {
  readonly id: string;
  readonly name: string;
  readonly size: number;
  readonly stage: UploadStage;
  readonly sent: number;
  readonly paced: boolean;
  readonly error?: string;
  readonly printerPath?: string;
}

const json = async <A>(response: Response): Promise<A> => {
  const body = (await response.json()) as A & { readonly error?: string };
  if (!response.ok) throw new Error(body.error ?? `The relay answered HTTP ${response.status}`);
  return body;
};

export const fetchPrintHeader = async (relayBase: string, taskId: string): Promise<PrintHeader> =>
  (await json<{ readonly header: PrintHeader }>(await authedFetch(`${relayBase}/api/prints/${encodeURIComponent(taskId)}`, { cache: "no-store" }))).header;

export const printPreviewUrl = (relayBase: string, taskId: string): string => `${relayBase}/api/prints/${encodeURIComponent(taskId)}/preview.png`;

export const fetchFiles = async (relayBase: string, path: string): Promise<FileList> => json<FileList>(await authedFetch(`${relayBase}/api/files?path=${encodeURIComponent(path)}`, { cache: "no-store" }));

export const fetchFileInfo = async (relayBase: string, path: string): Promise<PrintHeader> => json<PrintHeader>(await authedFetch(`${relayBase}/api/files/info?path=${encodeURIComponent(path)}`, { cache: "no-store" }));

/** A `.goo` file's slicer preview: 116 px (small, read from the file's first 27 KB) or 290 px (big). */
export const filePreviewUrl = (relayBase: string, path: string, big = false): string => `${relayBase}/api/files/preview.png?path=${encodeURIComponent(path)}${big ? "&size=big" : ""}`;

export const fetchUploads = async (relayBase: string): Promise<ReadonlyArray<UploadJob>> => (await json<{ readonly jobs: ReadonlyArray<UploadJob> }>(await authedFetch(`${relayBase}/api/uploads`, { cache: "no-store" }))).jobs;

export const cancelUpload = async (relayBase: string, id: string): Promise<void> => {
  await authedFetch(`${relayBase}/api/uploads/${encodeURIComponent(id)}`, { method: "DELETE" });
};

/** Why the relay refused an upload; `exists` when only the name is taken (retry with `overwrite`). */
export class UploadRefused extends Error {
  constructor(
    message: string,
    readonly exists: boolean,
  ) {
    super(message);
  }
}

/** The owner cancelled the upload while it was still on its way to the relay. */
export class UploadCancelled extends Error {
  constructor() {
    super("Cancelled");
  }
}

/**
 * Sends a local file (a document picker `uri`) to the relay, which passes it
 * on to the printer. Resolves with the relay's job once the relay has the
 * whole file; follow it with `fetchUploads`. `cancel` stops the phone's part,
 * and `done` then rejects with `UploadCancelled`.
 */
export const startUpload = (
  relayBase: string,
  fileUri: string,
  name: string,
  overwrite: boolean,
  onProgress: (fraction: number) => void,
): { readonly done: Promise<UploadJob>; readonly cancel: () => void } => {
  const task = new UploadTask(new File(fileUri), `${relayBase}/api/uploads?name=${encodeURIComponent(name)}${overwrite ? "&overwrite=1" : ""}`, {
    httpMethod: "POST",
    headers: { "content-type": "application/octet-stream" },
    onProgress: (progress) => {
      if (progress.totalBytes > 0) onProgress(progress.bytesSent / progress.totalBytes);
    },
  });
  let cancelled = false;
  const sent = task.uploadAsync().catch((cause: unknown) => {
    // Without an abort signal, a cancelled task rejects with the native error.
    throw cancelled ? new UploadCancelled() : cause;
  });
  const done = sent.then((result) => {
    let body: { readonly error?: string; readonly exists?: boolean } & Partial<UploadJob> = {};
    try {
      body = JSON.parse(result.body) as typeof body;
    } catch {
      // Not JSON: fall through to the status.
    }
    if (result.status === 202 && body.id !== undefined) return body as UploadJob;
    throw new UploadRefused(body.error ?? `The relay answered HTTP ${result.status}`, body.exists === true);
  });
  return {
    done,
    cancel: () => {
      cancelled = true;
      task.cancel();
    },
  };
};
