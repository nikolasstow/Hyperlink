/**
 * The relay's HTTP API, as the printer page uses it: the print file's header,
 * a file's details, starting a print, and uploads to the printer through the
 * relay (saturn-uploader `relay`). The file browser itself is the shared
 * explorer over the relay's files-v1 routes (explorer/httpFileSource.ts).
 *
 * Every reply is decoded with `Schema`: it crosses the network.
 *
 * Uploads never start a print. While a print runs, the relay paces them so the
 * printer is not disturbed, and it refuses to replace the file being printed.
 *
 * @internal
 */
import { Option, Schema } from "effect";
import { File, UploadTask } from "expo-file-system";
import { authedFetch, authHeaders } from "../auth/serverTokens";

/** A `.goo` file's header, as the relay reports it. */
export const PrintHeader = Schema.Struct({
  displayWidthMm: Schema.Number,
  displayHeightMm: Schema.Number,
  layerHeightMm: Schema.Number,
  layerCount: Schema.Number,
  exposureSeconds: Schema.Number,
  bottomExposureSeconds: Schema.Number,
  bottomLayerCount: Schema.Number,
  transitionLayerCount: Schema.Number,
  antiAliasing: Schema.Number,
  volumeMl: Schema.Number,
  materialGrams: Schema.Number,
  printSeconds: Schema.Number,
  softwareName: Schema.String,
  softwareVersion: Schema.String,
  createdAt: Schema.String,
});
export type PrintHeader = typeof PrintHeader.Type;

/** Every stage the relay reports for a job: a plain upload, or an edited copy that is saved and may start. */
export const UploadStage = Schema.Literals(["receiving", "queued", "copying", "editing", "hashing", "sending", "verifying", "saving", "starting", "done", "failed", "cancelled"]);
export type UploadStage = typeof UploadStage.Type;

/** An upload as the relay tracks it, from its first byte. */
export const UploadJob = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  size: Schema.Number,
  stage: UploadStage,
  /** Bytes the relay has from the sender (`receiving`); older relays leave it out. */
  received: Schema.optional(Schema.Number),
  sent: Schema.Number,
  paced: Schema.Boolean,
  error: Schema.optional(Schema.String),
  printerPath: Schema.optional(Schema.String),
  savedPath: Schema.optional(Schema.String),
  note: Schema.optional(Schema.String),
  started: Schema.optional(Schema.Boolean),
  /** Who sent the file, such as "UVtools on MacBook Pro (2)". */
  from: Schema.optional(Schema.String),
});
export type UploadJob = typeof UploadJob.Type;

const ErrorBody = Schema.Struct({
  error: Schema.optional(Schema.String),
  exists: Schema.optional(Schema.Boolean),
});

/** The relay's reason in an error reply, or the HTTP status. */
const refusalOf = (body: unknown, status: number): { readonly message: string; readonly exists: boolean } => {
  const error = Option.getOrUndefined(Schema.decodeUnknownOption(ErrorBody)(body));
  return { message: error?.error ?? `The relay answered HTTP ${status}`, exists: error?.exists === true };
};

/** The body of a relay reply, decoded with `schema`; an error reply throws its reason. */
const readJson = async <A>(response: Response, schema: Schema.Codec<A, unknown>): Promise<A> => {
  const body: unknown = await response.json();
  if (!response.ok) throw new Error(refusalOf(body, response.status).message);
  return Schema.decodeUnknownPromise(schema)(body);
};

export const fetchPrintHeader = async (relayBase: string, taskId: string): Promise<PrintHeader> =>
  (await readJson(await authedFetch(`${relayBase}/api/prints/${encodeURIComponent(taskId)}`, { cache: "no-store" }), Schema.Struct({ header: PrintHeader }))).header;

/** The relay's camera as H.264 over a WebSocket: one access unit per message. */
export const cameraSocketUrl = (relayBase: string): string => `${relayBase.replace(/^http/, "ws")}/api/camera.h264`;

/** The relay's camera lock: while it is on, the relay serves no camera to any device and turns the stream off. */
export const CameraLockState = Schema.Struct({
  locked: Schema.Boolean,
  since: Schema.NullOr(Schema.Number),
  byLabel: Schema.NullOr(Schema.String),
});
export type CameraLockState = typeof CameraLockState.Type;

/** The camera lock now. */
export const fetchCameraLock = async (relayBase: string): Promise<CameraLockState> =>
  readJson(await authedFetch(`${relayBase}/api/camera/lock`, { cache: "no-store" }), CameraLockState);

/** Locks or unlocks the camera for every device. Locking stops any live stream at once. */
export const setCameraLock = async (relayBase: string, locked: boolean): Promise<CameraLockState> =>
  readJson(await authedFetch(`${relayBase}/api/camera/${locked ? "lock" : "unlock"}`, { method: "POST" }), CameraLockState);

/** The last burn of a support job: did the self-check pass, and where the released file went. */
export const SupportBurn = Schema.Struct({
  passed: Schema.Boolean,
  savedPath: Schema.optional(Schema.NullOr(Schema.String)),
  sha256: Schema.optional(Schema.NullOr(Schema.String)),
  report: Schema.optional(Schema.Unknown),
  at: Schema.optional(Schema.NullOr(Schema.Number)),
});

/** A support job the relay owns (saturn-uploader SupportJobs). Both apps render it from the relay by id. */
export const SupportJob = Schema.Struct({
  id: Schema.String,
  gooPath: Schema.String,
  stlPath: Schema.String,
  /** "waiting" | "analyzing" | "ready" | "burning" | "burned" | "failed". */
  stage: Schema.String,
  next: Schema.optional(Schema.NullOr(Schema.String)),
  waitingFor: Schema.optional(Schema.NullOr(Schema.String)),
  /** The CLI's last progress stage ("read", "plan", "areas", …). */
  step: Schema.optional(Schema.NullOr(Schema.String)),
  seconds: Schema.optional(Schema.NullOr(Schema.Number)),
  deletions: Schema.optional(Schema.Unknown),
  summary: Schema.optional(Schema.Unknown),
  burn: Schema.optional(Schema.NullOr(SupportBurn)),
  error: Schema.optional(Schema.NullOr(Schema.String)),
  createdAt: Schema.Number,
  updatedAt: Schema.optional(Schema.NullOr(Schema.Number)),
});
export type SupportJob = typeof SupportJob.Type;

/** The relay is still working on this job: ask again soon. */
export const supportJobBusy = (job: SupportJob): boolean =>
  job.stage === "waiting" || job.stage === "analyzing" || job.stage === "burning";

/** Every support job the relay keeps, newest first. */
export const fetchSupportJobs = async (relayBase: string): Promise<ReadonlyArray<SupportJob>> =>
  (await readJson(await authedFetch(`${relayBase}/api/support/jobs`, { cache: "no-store" }), Schema.Struct({ jobs: Schema.Array(SupportJob) }))).jobs;

/** One support job by id. The relay answers 202 while it still works and 200 once it is ready/burned/failed. */
export const fetchSupportJob = async (relayBase: string, id: string): Promise<SupportJob> =>
  readJson(await authedFetch(`${relayBase}/api/support/jobs/${encodeURIComponent(id)}`, { cache: "no-store" }), SupportJob);

/** Burns the supports into a new file, held for approval. The job goes to "burning", then "burned" or "ready". */
export const burnSupportJob = async (relayBase: string, id: string): Promise<SupportJob> =>
  readJson(await authedFetch(`${relayBase}/api/support/jobs/${encodeURIComponent(id)}/burn`, { method: "POST" }), SupportJob);

/**
 * The relay-served review/approve page for a job, for a WebView. A web view cannot send a header, so with a token
 * the address carries it, as the camera page does. NOTE: this needs the relay to sign a view in from `?token=` on
 * the page path (a small RelayAuth change on the approval-page branch), and the page route itself (feat/approval-page).
 */
export const approvalPageUrl = (base: string, id: string, token: string | undefined): string =>
  `${base}/api/support/jobs/${encodeURIComponent(id)}/page${token === undefined ? "" : `?token=${encodeURIComponent(token)}`}`;

export const printPreviewUrl = (relayBase: string, taskId: string): string => `${relayBase}/api/prints/${encodeURIComponent(taskId)}/preview.png`;

export const fetchFileInfo = async (relayBase: string, path: string): Promise<PrintHeader> =>
  readJson(await authedFetch(`${relayBase}/api/files/info?path=${encodeURIComponent(path)}`, { cache: "no-store" }), PrintHeader);

/**
 * Starts printing a file from the printer's storage or its USB drive, from
 * layer 0. The relay refuses while a print runs, and when the printer does not
 * list the file; the reason comes back as the error.
 */
export const printFile = async (relayBase: string, path: string): Promise<void> => {
  await readJson(await authedFetch(`${relayBase}/api/files/print?path=${encodeURIComponent(path)}`, { method: "POST" }), Schema.Struct({ started: Schema.String }));
};

export const fetchUploads = async (relayBase: string): Promise<ReadonlyArray<UploadJob>> =>
  (await readJson(await authedFetch(`${relayBase}/api/uploads`, { cache: "no-store" }), Schema.Struct({ jobs: Schema.Array(UploadJob) }))).jobs;

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

const decodeJobReply = Schema.decodeUnknownOption(Schema.fromJsonString(UploadJob));
const decodeErrorReply = Schema.decodeUnknownOption(Schema.fromJsonString(ErrorBody));

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
    headers: { "content-type": "application/octet-stream", ...authHeaders(relayBase) },
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
    const job = result.status === 202 ? decodeJobReply(result.body) : Option.none();
    if (Option.isSome(job)) return job.value;
    const refusal = Option.getOrUndefined(decodeErrorReply(result.body));
    throw new UploadRefused(refusal?.error ?? `The relay answered HTTP ${result.status}`, refusal?.exists === true);
  });
  return {
    done,
    cancel: () => {
      cancelled = true;
      task.cancel();
    },
  };
};
