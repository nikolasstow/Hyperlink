/**
 * Files the relay builds for each print, kept on the device: the layer pack
 * (layerPack.ts) and the 3D model's levels (printModel.ts), by print or by
 * file path. While the relay builds the file it answers 202 with its
 * progress, and after a failed build 503; the app asks again.
 *
 * The app downloads each file once per print and keeps the last few in the
 * cache folder, so the page that shows it never waits for the network.
 *
 * @internal
 */
import { Directory, File, Paths } from "expo-file-system";
import { authHeaders } from "../auth/serverTokens";

/** How long the app waits before it asks again while the relay builds the file. */
const RETRY_MS = 5_000;
/** How long the app waits after a failed download or build. */
const FAILED_RETRY_MS = 60_000;
/** How many failures in a row the app retries by itself; the next `ensure` starts again. */
const MAX_FAILED_RETRIES = 5;

/** Where a print's file stands on this device. */
export type DownloadState =
  | { readonly kind: "Building"; readonly done: number; readonly total: number }
  | { readonly kind: "Downloading" }
  | { readonly kind: "Ready" }
  | { readonly kind: "Failed"; readonly reason: string };

/** One kind of file the relay builds. */
export interface DownloadKind<T> {
  /** The folder in the cache. */
  readonly folder: string;
  /** Where the relay serves the file with this id. */
  readonly urlOf: (relayBase: string, id: string) => string;
  /** The file's extension on the device, with its dot. */
  readonly extension: string;
  /** How many prints' files the device keeps; the oldest go first. */
  readonly keep: number;
  /** Reads what the app needs from a downloaded file. Undefined when it is not one. */
  readonly open: (file: File) => T | undefined;
}

/** The files of one kind on this device. */
export interface Downloads<T> {
  /** Gets the file with `id` (a print's task id, or a file's id) onto the device, once. Safe to call often: one download runs per id. */
  readonly ensure: (relayBase: string, id: string) => void;
  readonly state: (id: string) => DownloadState | undefined;
  /** What `open` read from the file, once it is on the device. */
  readonly opened: (id: string) => T | undefined;
  /** Calls `listener` on each change of any state. Returns the stop. */
  readonly subscribe: (listener: () => void) => () => void;
}

const decodeAnswer = (text: string): DownloadState => {
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
  return { kind: "Failed", reason: "The relay sent something that is not the file it builds" };
};

export const makeDownloads = <T>(kind: DownloadKind<T>): Downloads<T> => {
  const states = new Map<string, DownloadState>();
  const openedFiles = new Map<string, T>();
  const listeners = new Set<() => void>();
  const working = new Set<string>();
  // Failures in a row, by id: a file the relay cannot make yet is not asked for forever.
  const failures = new Map<string, number>();

  const folder = (): Directory => new Directory(Paths.cache, kind.folder);
  const fileOf = (taskId: string): File => new File(folder(), `${taskId.replace(/[^A-Za-z0-9._-]/g, "_")}${kind.extension}`);

  const setState = (taskId: string, state: DownloadState): void => {
    states.set(taskId, state);
    listeners.forEach((listener) => listener());
  };

  /** Deletes all but the newest `keep` files. */
  const prune = (): void => {
    const files = folder()
      .list()
      .filter((entry): entry is File => entry instanceof File && entry.name.endsWith(kind.extension))
      .sort((a, b) => (b.modificationTime ?? 0) - (a.modificationTime ?? 0));
    files.slice(kind.keep).forEach((old) => old.delete());
  };

  const ensure = (relayBase: string, taskId: string): void => {
    failures.delete(taskId);
    fetchFile(relayBase, taskId);
  };

  const fetchFile = (relayBase: string, taskId: string): void => {
    if (working.has(taskId) || openedFiles.has(taskId)) return;
    const target = fileOf(taskId);
    if (target.exists) {
      const ready = kind.open(target);
      if (ready !== undefined) {
        openedFiles.set(taskId, ready);
        setState(taskId, { kind: "Ready" });
        return;
      }
      target.delete();
    }
    working.add(taskId);
    const dir = folder();
    if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
    const part = new File(dir, `${target.name}.part`);
    const url = kind.urlOf(relayBase, taskId);
    const again = (ms: number): void => {
      setTimeout(() => fetchFile(relayBase, taskId), ms);
    };
    const failedAgain = (): void => {
      const count = (failures.get(taskId) ?? 0) + 1;
      failures.set(taskId, count);
      if (count < MAX_FAILED_RETRIES) again(FAILED_RETRY_MS);
    };
    setState(taskId, { kind: "Downloading" });
    File.downloadFileAsync(url, part, { idempotent: true, headers: authHeaders(url) })
      .then((downloaded) => {
        if (kind.open(downloaded) === undefined) {
          // A 202 or a 503: a short JSON answer, not the file.
          const answer = decodeAnswer(downloaded.textSync());
          downloaded.delete();
          setState(taskId, answer);
          if (answer.kind === "Building") again(RETRY_MS);
          else failedAgain();
          return;
        }
        if (target.exists) target.delete();
        downloaded.move(target);
        const ready = kind.open(target);
        if (ready === undefined) {
          setState(taskId, { kind: "Failed", reason: "The file did not read back after the download" });
          failedAgain();
          return;
        }
        openedFiles.set(taskId, ready);
        failures.delete(taskId);
        setState(taskId, { kind: "Ready" });
        prune();
      })
      .catch((error: unknown) => {
        if (part.exists) part.delete();
        setState(taskId, { kind: "Failed", reason: error instanceof Error ? error.message : String(error) });
        failedAgain();
      })
      .finally(() => working.delete(taskId));
  };

  return {
    ensure,
    state: (taskId) => states.get(taskId),
    opened: (taskId) => openedFiles.get(taskId),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};
