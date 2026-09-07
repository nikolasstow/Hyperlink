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
import { Data, Effect, FileSystem, Layer, ManagedRuntime, Path, Schema } from "effect";
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

const resolveWithin = (requested: string): Effect.Effect<string, FsError, FileSystem.FileSystem | Path.Path> =>
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
