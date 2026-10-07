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
import { Effect } from "effect";
import { runFs } from "./effect/runtime";
import { type FsEntry, FsError, fsTree } from "./fsClient";

const listings = new Map<string, ReadonlyArray<FsEntry>>();

/** Opaque per-client sync id from the server; undefined until the first bundle. */
let sessionId: string | undefined;

export const getCachedListing = (path: string): ReadonlyArray<FsEntry> | undefined => listings.get(path);

/** A folder loaded into the cache, or not there. */
export type TreeLoad = "loaded" | "missing";

/** One request: merged into the cache; `unsent` when the server sent nothing
 * for `dir` and the cache has nothing for it either. */
const fetchTree = (backend: string, dir: string, session: string | undefined): Effect.Effect<TreeLoad | "unsent", FsError> =>
  fsTree(backend, dir, session).pipe(
    Effect.map((result): TreeLoad | "unsent" => {
      if (result.kind === "missing") return "missing";
      sessionId = result.delta.session;
      for (const [path, data] of Object.entries(result.delta.dirs)) listings.set(path, data.entries);
      return listings.has(dir) ? "loaded" : "unsent";
    }),
  );

/**
 * Load the hot tree rooted at `dir` from the server and merge it into the cache,
 * carrying the session id so only changed directories come back. Resolves once
 * merged (a directory whose listing wasn't returned, unchanged, keeps its cached
 * entries), or `missing` for a folder that isn't there (another worktree
 * without it). Rejects so a caller can surface a failed open.
 *
 * The server keeps what it sent by a folder's real path, but answers in the
 * form asked (`~/…` or in full), so a folder first sent in one form comes back
 * empty asked in the other (a worktree switched to, a path from a chat): asked
 * again as a new session, which sends everything.
 */
export const loadTree = (backend: string, dir: string): Promise<TreeLoad> =>
  runFs(
    fetchTree(backend, dir, sessionId).pipe(
      Effect.flatMap((first) => (first === "unsent" ? fetchTree(backend, dir, undefined) : Effect.succeed(first))),
      Effect.flatMap((load): Effect.Effect<TreeLoad, FsError> => (load === "unsent" ? Effect.fail(new FsError({ reason: "decode", path: dir })) : Effect.succeed(load))),
    ),
  );
