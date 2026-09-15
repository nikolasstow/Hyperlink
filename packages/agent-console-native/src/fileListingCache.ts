/**
 * App-level cache of directory listings, shared across every explorer screen so
 * a folder isn't re-fetched each time it's opened — drilling in, backing out and
 * re-entering, or re-expanding all paint instantly from here. Survives screen
 * unmount (module-level, like sessionCache/repoScanCache).
 *
 * Filling it is the server's job: `loadTree` asks for the hot subtree rooted at a
 * directory and the server returns the whole ranked bundle in one response —
 * several levels deep, most-likely-opened folders first. The server tracks what
 * this client already has via an opaque session id (issued in the first
 * response, echoed thereafter), so repeat requests return only what changed and
 * nothing already sent is sent again. The session id lives here in memory
 * alongside the cache; a fresh app launch starts both empty and gets a new
 * session with everything.
 *
 * @internal
 */
import { runFs } from "./effect/runtime";
import { fsList, fsTree, type FsEntry } from "./fsClient";

const listings = new Map<string, ReadonlyArray<FsEntry>>();

/** Opaque per-client sync id from the server; undefined until the first bundle. */
let sessionId: string | undefined;

export const getCachedListing = (path: string): ReadonlyArray<FsEntry> | undefined => listings.get(path);

/**
 * Load the directory at `dir` and cache it. Prefers the hot tree bundle (which
 * also warms the subtree and dedups via the session id), but falls back to a
 * plain per-directory listing if the bundle request fails for any reason — so
 * the explorer works even where `/fs/tree` doesn't, just without the prefetch.
 * Resolves once merged; rejects only if the fallback listing also fails.
 */
export const loadTree = (backend: string, dir: string): Promise<void> =>
  runFs(fsTree(backend, dir, sessionId))
    .then((delta) => {
      sessionId = delta.session;
      for (const [path, data] of Object.entries(delta.dirs)) {
        listings.set(path, data.entries);
      }
    })
    .catch(() =>
      runFs(fsList(backend, dir)).then((entries) => {
        listings.set(dir, entries);
      }),
    );
