/**
 * The repo's files on the agent-console server as a file source for the
 * shared explorer. Listings come from the server's tree sessions and live in
 * the app's listing cache (fileListingCache.ts), which tab previews read too.
 *
 * @internal
 */
import { Effect } from "effect";
import type { FileSource, FileSourceEntry, FileSourceListing } from "../explorer/FileSource";
import { FileSourceError } from "../explorer/FileSource";
import { getCachedListing, loadTree } from "../fileListingCache";
import type { FsEntry } from "../fsClient";

const joinPath = (parent: string, name: string): string => `${parent.replace(/\/+$/, "")}/${name}`;

const entriesOf = (dir: string, entries: ReadonlyArray<FsEntry>): ReadonlyArray<FileSourceEntry> =>
  entries.map((entry) => ({ path: joinPath(dir, entry.name), name: entry.name, kind: entry.type }));

/** A short, displayable reason from a failed load (an `FsError`, or anything thrown). */
const describeError = (error: unknown): string => {
  if (typeof error === "object" && error !== null && "reason" in error) {
    const reason = String(error.reason);
    const status = "status" in error ? error.status : undefined;
    return status === undefined ? reason : `${reason} ${String(status)}`;
  }
  return String(error);
};

/** The files of the server at `backend`. Make one per backend and keep it (the explorer reloads when the source changes). */
export const repoSource = (backend: string): FileSource => ({
  id: `repo:${backend}`,
  cached: (path) => {
    const cached = getCachedListing(path);
    return cached === undefined ? undefined : entriesOf(path, cached);
  },
  list: (path) =>
    Effect.tryPromise({
      try: () => loadTree(backend, path),
      catch: (error) => new FileSourceError({ reason: "Transport", path, message: describeError(error) }),
    }).pipe(
      Effect.map((load): FileSourceListing => {
        const fresh = getCachedListing(path);
        return load === "loaded" && fresh !== undefined ? { _tag: "Found", entries: entriesOf(path, fresh) } : { _tag: "Missing" };
      }),
    ),
});
