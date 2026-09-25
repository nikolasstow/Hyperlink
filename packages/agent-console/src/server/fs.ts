/**
 * Filesystem access for the file explorer and repo/branch scan, as Effect.
 *
 * The Effect core of the `/fs` endpoints: a home-confined directory listing and
 * text read, expressed with the `FileSystem`/`Path` platform services and
 * `Schema`-typed results rather than raw `node:fs`, with a `Data.TaggedError`
 * error channel. filesPlugin.ts is a thin connect-middleware adapter that runs
 * these against `fsRuntime` and maps the tagged error to a status code — the
 * vite/connect boundary is left plain on purpose, since making it Effect-native
 * would mean re-architecting how every plugin mounts.
 *
 * Confinement: every request resolves to a real path (symlinks followed) that
 * must still sit inside the root — the server's home directory, or
 * `AGENT_CONSOLE_FS_ROOT`. A leading `~` is expanded against home so a client
 * can pass a `~/Coding`-style path without resolving `$HOME` itself.
 *
 * @internal
 */
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { Data, Effect, FileSystem, Layer, ManagedRuntime, Option, Path, Schema } from "effect";
import { homedir } from "node:os";

export class FsError extends Data.TaggedError("FsError")<{
  readonly reason: "not-found" | "outside-root" | "not-a-directory" | "not-a-file" | "too-large" | "io";
  readonly path: string;
}> {}

export const FsEntry = Schema.Struct({
  name: Schema.String,
  type: Schema.Literals(["file", "directory"]),
});
export type FsEntry = typeof FsEntry.Type;

export const FsListing = Schema.Struct({
  path: Schema.String,
  entries: Schema.Array(FsEntry),
});
export type FsListing = typeof FsListing.Type;

/** Text reads are for source/config files and `.git` metadata; a hard cap keeps
 * a stray multi-gigabyte file from being slurped into memory. */
const MAX_READ_BYTES = 5_000_000;

const fsRoot = (): string => process.env.AGENT_CONSOLE_FS_ROOT ?? homedir();

/** The configured root, for logging. */
export const fsRootPath = (): string => fsRoot();

/** `requested` resolved (symlinks followed) and confined to the files root.
 * Shared by every endpoint that takes a path from the network. */
export const resolveWithin = (requested: string): Effect.Effect<string, FsError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const fs = yield* FileSystem.FileSystem;
    const root = yield* fs.realPath(fsRoot()).pipe(Effect.orElseSucceed(() => path.resolve(fsRoot())));

    const expanded = requested === "~" || requested.startsWith("~/") ? path.join(homedir(), requested.slice(1)) : requested;
    if (!path.isAbsolute(expanded)) return yield* new FsError({ reason: "outside-root", path: requested });

    const candidate = path.resolve(expanded);
    const before = path.relative(root, candidate);
    if (before.startsWith("..") || path.isAbsolute(before)) return yield* new FsError({ reason: "outside-root", path: requested });

    const real = yield* fs.realPath(candidate).pipe(Effect.mapError(() => new FsError({ reason: "not-found", path: requested })));
    const after = path.relative(root, real);
    if (after.startsWith("..") || path.isAbsolute(after)) return yield* new FsError({ reason: "outside-root", path: requested });

    return real;
  });

/** Directory entries at `requested` (directories first, then alphabetical). */
export const listDirectory = (requested: string): Effect.Effect<FsListing, FsError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const target = yield* resolveWithin(requested);

    const info = yield* fs.stat(target).pipe(Effect.mapError(() => new FsError({ reason: "not-found", path: requested })));
    if (info.type !== "Directory") return yield* new FsError({ reason: "not-a-directory", path: requested });

    const names = yield* fs.readDirectory(target).pipe(Effect.mapError(() => new FsError({ reason: "io", path: requested })));
    // readDirectory returns names only, so each is stat'd for its type; a stat
    // that fails (a broken symlink, a race) degrades to "file" rather than
    // dropping the entry.
    const entries = yield* Effect.forEach(
      names,
      (name) =>
        fs.stat(path.join(target, name)).pipe(
          Effect.map((entryInfo): FsEntry => ({ name, type: entryInfo.type === "Directory" ? "directory" : "file" })),
          Effect.orElseSucceed((): FsEntry => ({ name, type: "file" })),
        ),
      { concurrency: 16 },
    );

    const sorted = [...entries].sort((a, b) =>
      a.type === b.type ? a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) : a.type === "directory" ? -1 : 1,
    );
    return { path: target, entries: sorted };
  });

/** One entry in a directory. */
export interface FsDirEntry {
  readonly name: string;
  readonly type: "file" | "directory";
}

/** A directory's listing plus a content version — a fingerprint of its entries
 * (names + types), so it changes exactly when the listing a client holds would.
 */
export interface FsDirData {
  readonly version: string;
  readonly entries: ReadonlyArray<FsDirEntry>;
}

/**
 * A tree bundle as a flat map of directory → listing, carrying only the
 * directories that are NEW or CHANGED for the requesting client (per the
 * versions it reported). Unchanged directories are omitted — the client keeps
 * what it cached — so nothing already sent is sent again unless it changed.
 */
export interface FsTreeDelta {
  readonly root: string;
  readonly dirs: Record<string, FsDirData>;
}

/** Never crawled into for a tree bundle — huge and rarely browsed; they still
 * list on demand when actually opened. */
const TREE_SKIP = new Set([
  "node_modules",
  ".git",
  ".hg",
  ".svn",
  ".next",
  ".nuxt",
  ".expo",
  ".turbo",
  ".cache",
  "dist",
  "build",
  "out",
  "coverage",
  "target",
  "vendor",
  ".venv",
  "venv",
  "__pycache__",
  ".gradle",
  "Pods",
  "DerivedData",
]);

/** How many directories a tree bundle will expand, and how deep — bounds the
 * work and the payload while still reaching the hot branches. */
const TREE_BUDGET = 1500;
const TREE_MAX_DEPTH = 12;

/** Access frequency per directory, bumped whenever a directory is listed or a
 * tree is requested, so folders the user actually opens rank higher in later
 * bundles. Module-level for the process; a decayed/persisted version can come
 * with the Last backend. */
const accessCounts = new Map<string, number>();

/** Record that a directory was requested, for hotness ranking. */
export const noteAccess = (requested: string): void => {
  accessCounts.set(requested, (accessCounts.get(requested) ?? 0) + 1);
};

/**
 * Per-client sync state: the versions this client has already been sent, keyed
 * by directory. The client holds only an opaque session id (issued in the first
 * response) and echoes it back; the server remembers what it sent, so the client
 * never has to upload its whole set. A client with no data (fresh app) sends no
 * id and gets a new session that receives everything.
 */
interface Session {
  readonly sent: Map<string, string>;
  lastSeen: number;
}
const sessions = new Map<string, Session>();
const MAX_SESSIONS = 64;

/** Resolve an incoming session id to its sent-versions map, creating a fresh
 * session for a missing or unknown id (evicting the least-recently-used one when
 * full). The returned id is what the client should use going forward. */
export const resolveSession = (id: string | undefined): { readonly id: string; readonly sent: Map<string, string> } => {
  const now = Date.now();
  if (id !== undefined) {
    const existing = sessions.get(id);
    if (existing !== undefined) {
      existing.lastSeen = now;
      return { id, sent: existing.sent };
    }
  }
  if (sessions.size >= MAX_SESSIONS) {
    let oldestId: string | undefined;
    let oldest = Number.POSITIVE_INFINITY;
    for (const [sid, session] of sessions) {
      if (session.lastSeen < oldest) {
        oldest = session.lastSeen;
        oldestId = sid;
      }
    }
    if (oldestId !== undefined) sessions.delete(oldestId);
  }
  const newId = globalThis.crypto.randomUUID();
  const sent = new Map<string, string>();
  sessions.set(newId, { sent, lastSeen: now });
  return { id: newId, sent };
};

interface EntryMeta {
  readonly name: string;
  readonly type: "file" | "directory";
  readonly mtime: number;
}

/** A directory's entries with each one's mtime (directories first, then
 * alphabetical). A failed stat degrades to a file with mtime 0. */
const listWithMeta = (dir: string): Effect.Effect<ReadonlyArray<EntryMeta>, FsError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const names = yield* fs.readDirectory(dir).pipe(Effect.mapError(() => new FsError({ reason: "io", path: dir })));
    const entries = yield* Effect.forEach(
      names,
      (name) =>
        fs.stat(path.join(dir, name)).pipe(
          Effect.map((info): EntryMeta => ({
            name,
            type: info.type === "Directory" ? "directory" : "file",
            mtime: Option.getOrUndefined(info.mtime)?.getTime() ?? 0,
          })),
          Effect.orElseSucceed((): EntryMeta => ({ name, type: "file", mtime: 0 })),
        ),
      { concurrency: 16 },
    );
    return [...entries].sort((a, b) =>
      a.type === b.type ? a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) : a.type === "directory" ? -1 : 1,
    );
  });

/** A fast, order-independent-per-entry content fingerprint of a directory's
 * listing (names + types). Changes precisely when entries are added, removed,
 * renamed or change type — i.e. when a client's cached listing would be stale.
 * FNV-1a over the sorted `name\ttype` lines; collisions only cost a redundant
 * resend, never staleness beyond a real change. */
const versionOf = (entries: ReadonlyArray<EntryMeta>): string => {
  let hash = 0x811c9dc5;
  for (const entry of entries) {
    const line = `${entry.name}\t${entry.type}\n`;
    for (let i = 0; i < line.length; i += 1) {
      hash ^= line.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
  }
  return (hash >>> 0).toString(36);
};

/**
 * Build a directory tree bundle in one shot, expanding the HOT branches deep —
 * most-accessed first, then most-recently-modified — up to a budget, so the
 * folders a client is most likely to open next arrive already loaded. Returns a
 * DELTA: only directories whose version differs from what this session was last
 * sent are included, so unchanged data isn't resent. `sent` is the session's
 * record of what the client already has; it's updated in place to the versions
 * the client holds after this response. Still recurses through unchanged
 * directories to catch changes deeper down. Rooted at any `requested` directory,
 * so the same logic applies to every folder request, not just the top.
 */
export const buildTree = (
  requested: string,
  sent: Map<string, string>,
): Effect.Effect<FsTreeDelta, FsError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const target = yield* resolveWithin(requested);

    const info = yield* fs.stat(target).pipe(Effect.mapError(() => new FsError({ reason: "not-found", path: requested })));
    if (info.type !== "Directory") return yield* new FsError({ reason: "not-a-directory", path: requested });

    // Echo paths back in the SAME form the client asked with (it may pass a
    // `~/…` path, which `resolveWithin` expanded to a real one). The client keys
    // its cache and builds child paths off what it sent, so returning resolved
    // real paths would never match. `sent` (the session's dedup) stays keyed by
    // the real path — stable across whatever form the client requests.
    const requestedRoot = requested.replace(/\/+$/, "");
    const asRequested = (real: string): string => requestedRoot + real.slice(target.length);

    const dirs: Record<string, FsDirData> = {};

    interface Task {
      readonly path: string;
      readonly depth: number;
      readonly score: number;
      readonly mtime: number;
    }
    // Root first (highest priority), then hot-branch-first from there.
    const frontier: Task[] = [{ path: target, depth: 0, score: Number.POSITIVE_INFINITY, mtime: Number.POSITIVE_INFINITY }];
    const seen = new Set<string>([target]);
    let expanded = 0;

    while (frontier.length > 0 && expanded < TREE_BUDGET) {
      // Highest-priority pending directory: most-accessed, then most-recent.
      let best = 0;
      for (let i = 1; i < frontier.length; i += 1) {
        const a = frontier[i];
        const b = frontier[best];
        if (a.score > b.score || (a.score === b.score && a.mtime > b.mtime)) best = i;
      }
      const [task] = frontier.splice(best, 1);

      const meta = yield* listWithMeta(task.path).pipe(Effect.orElseSucceed((): ReadonlyArray<EntryMeta> => []));
      const version = versionOf(meta);
      expanded += 1;

      // Only send it if what the session last received is missing or stale;
      // either way record the version it now holds.
      if (sent.get(task.path) !== version) {
        dirs[asRequested(task.path)] = { version, entries: meta.map((entry): FsDirEntry => ({ name: entry.name, type: entry.type })) };
        sent.set(task.path, version);
      }

      // Recurse into subdirs regardless of whether this one changed — a deeper
      // directory may have.
      if (task.depth < TREE_MAX_DEPTH) {
        for (const entry of meta) {
          if (entry.type !== "directory" || TREE_SKIP.has(entry.name)) continue;
          const childPath = path.join(task.path, entry.name);
          if (seen.has(childPath)) continue;
          seen.add(childPath);
          frontier.push({ path: childPath, depth: task.depth + 1, score: accessCounts.get(childPath) ?? 0, mtime: entry.mtime });
        }
      }
    }

    return { root: requestedRoot, dirs };
  });

/** Text contents of `requested`, capped at MAX_READ_BYTES. */
export const readTextFile = (requested: string): Effect.Effect<string, FsError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const target = yield* resolveWithin(requested);

    const info = yield* fs.stat(target).pipe(Effect.mapError(() => new FsError({ reason: "not-found", path: requested })));
    if (info.type !== "File") return yield* new FsError({ reason: "not-a-file", path: requested });
    if (Number(info.size) > MAX_READ_BYTES) return yield* new FsError({ reason: "too-large", path: requested });

    return yield* fs.readFileString(target).pipe(Effect.mapError(() => new FsError({ reason: "io", path: requested })));
  });

/** HTTP status for each failure reason. `outside-root` is reported as 404 so a
 * probe can't tell a blocked path from a missing one. */
export const statusOfFsError = (error: FsError): number => {
  switch (error.reason) {
    case "not-found":
    case "outside-root":
      return 404;
    case "not-a-directory":
    case "not-a-file":
      return 400;
    case "too-large":
      return 413;
    case "io":
      return 500;
  }
};

/** One runtime for the plugin's lifetime, providing the node FileSystem + Path
 * services these Effects require. */
export const fsRuntime = ManagedRuntime.make(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer));
