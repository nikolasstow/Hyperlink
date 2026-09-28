/**
 * The workspace as the NPM plugin reads it: every package.json in it (with
 * dependency folders and build output skipped), and each package's own
 * package manager, from its `packageManager` field or else the nearest
 * lockfile, as the package's maintainers would run it.
 *
 * @internal
 */
import { Effect, FileSystem, Option, Path, Schema } from "effect";
import { OpenFile, PluginError, RunTask, type PluginAction, type PluginGroup } from "../../plugin/api";
import { readScripts } from "./packageJson";

/** Folders never searched for packages. */
const skipped = new Set(["node_modules", ".git", "dist", "build", ".next", ".expo", ".turbo", "coverage", "repos", "archive", "ios", "android", "Pods"]);

/** How deep the search for packages goes. */
const maxDepth = 6;

export const packageJson = Schema.Struct({
  name: Schema.optionalKey(Schema.String),
  version: Schema.optionalKey(Schema.String),
  description: Schema.optionalKey(Schema.String),
  license: Schema.optionalKey(Schema.String),
  private: Schema.optionalKey(Schema.Boolean),
  packageManager: Schema.optionalKey(Schema.String),
  engines: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  dependencies: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  devDependencies: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  peerDependencies: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  optionalDependencies: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  // The rest of what the details page shows: shapes vary between packages,
  // so these are read as they come and written out as text.
  author: Schema.optionalKey(Schema.Unknown),
  homepage: Schema.optionalKey(Schema.String),
  repository: Schema.optionalKey(Schema.Unknown),
  type: Schema.optionalKey(Schema.String),
  main: Schema.optionalKey(Schema.String),
  module: Schema.optionalKey(Schema.String),
  types: Schema.optionalKey(Schema.String),
  keywords: Schema.optionalKey(Schema.Array(Schema.String)),
  workspaces: Schema.optionalKey(Schema.Unknown),
});
export const packageJsonText = Schema.fromJsonString(packageJson);

/** Lockfiles and the package manager each belongs to, most specific first. */
const lockfiles: ReadonlyArray<readonly [string, string]> = [
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"],
  ["package-lock.json", "npm"],
];

export const failed = (message: string) => (cause: unknown) =>
  new PluginError({
    message: `${message}: ${cause instanceof Error ? cause.message : String(cause)}`,
  });

/** Every package.json under `dir`, in path order. An unreadable folder is
 * skipped, as a file search skips what it cannot list. */
export const findPackages = (dir: string, depth: number): Effect.Effect<ReadonlyArray<string>, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const entries = yield* fs.readDirectory(dir).pipe(Effect.orElseSucceed((): ReadonlyArray<string> => []));
    const here = entries.includes("package.json") ? [path.join(dir, "package.json")] : [];
    if (depth >= maxDepth) return here;
    const below = yield* Effect.forEach(
      [...entries].filter((entry) => !skipped.has(entry) && !entry.startsWith(".")).sort(),
      (entry) => {
        const full = path.join(dir, entry);
        return fs.stat(full).pipe(
          Effect.flatMap((info) => (info.type === "Directory" ? findPackages(full, depth + 1) : Effect.succeed([]))),
          Effect.orElseSucceed((): ReadonlyArray<string> => []),
        );
      },
    );
    return [...here, ...below.flat()];
  });

/** A declared `packageManager` (`pnpm@10.33.4+sha512…`) as name and version. */
export const declaredManager = (declared: string) => {
  const [name = "npm", version] = declared.split("@");
  return {
    name,
    version: version?.split("+")[0],
  };
};

/** The package manager for the package in `dir`: its `packageManager` field,
 * else the nearest lockfile at or above it, else npm. The search goes past
 * the workspace: a package inside a monorepo is managed by the root's
 * lockfile, which is how package managers find their workspace root too. */
export const packageManagerFor = (dir: string, declared: string | undefined) =>
  Effect.gen(function* () {
    if (declared !== undefined) return declaredManager(declared).name;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const lockfileIn = (folder: string): Effect.Effect<Option.Option<string>> =>
      Effect.findFirst(lockfiles, ([file]) => fs.exists(path.join(folder, file)).pipe(Effect.orElseSucceed(() => false))).pipe(
        Effect.map(Option.map(([, manager]) => manager)),
      );
    const search = (folder: string): Effect.Effect<string> =>
      lockfileIn(folder).pipe(
        Effect.flatMap(
          Option.match({
            onSome: Effect.succeed,
            onNone: () => {
              const parent = path.dirname(folder);
              return parent === folder ? Effect.succeed("npm") : search(parent);
            },
          }),
        ),
      );
    return yield* search(dir);
  });

/** One package.json, read. `key` is its folder relative to the workspace
 * (`.` for the workspace's own), the same in every worktree of a repo. */
export interface Package {
  readonly file: string;
  readonly dir: string;
  readonly key: string;
  readonly text: string;
  readonly json: typeof packageJson.Type;
  readonly scripts: ReadonlyArray<readonly [string, string]>;
  readonly manager: string;
}

export const readPackage = (file: string, workspace: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const text = yield* fs.readFileString(file).pipe(Effect.mapError(failed(`reading ${file}`)));
    const json = yield* Schema.decodeUnknownEffect(packageJsonText)(text).pipe(Effect.mapError(failed(`${file} is not a package.json`)));
    const scripts = yield* readScripts(text).pipe(Effect.mapError(failed(file)));
    const dir = path.dirname(file);
    const manager = yield* packageManagerFor(dir, json.packageManager);
    const relative = path.relative(workspace, dir);
    const read: Package = {
      file,
      dir,
      key: relative.length === 0 ? "." : relative,
      text,
      json,
      scripts,
      manager,
    };
    return read;
  });

export const packagesIn = (workspace: string) => findPackages(workspace, 0).pipe(Effect.flatMap((files) => Effect.forEach(files, (file) => readPackage(file, workspace))));

/** The 1-based line of `script` inside the `scripts` block of package.json. */
export const scriptLine = (text: string, script: string): number | undefined => {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => /"scripts"\s*:/.test(line));
  if (start < 0) return undefined;
  const quoted = `"${script.replaceAll('"', '\\"')}"`;
  const offset = lines.slice(start + 1).findIndex((line) => new RegExp(`${quoted.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:`).test(line));
  return offset < 0 ? undefined : start + 2 + offset;
};

export const openAt = (file: string, line: number | undefined, title: string): PluginAction => ({
  command: "npm.open",
  title,
  icon: "codicon:go-to-file",
  run: Effect.succeed(
    new OpenFile({
      path: file,
      ...(line === undefined ? {} : { line }),
    }),
  ),
});

/** A form value, or a failure naming the field that is missing. */
export const valueOf = (values: Readonly<Record<string, string>>, field: string) => {
  const value = values[field];
  return value === undefined ? Effect.fail(new PluginError({ message: `the form has no ${field}` })) : Effect.succeed(value);
};

export const packageGroup = (pkg: Package, workspace: string): PluginGroup => ({
  key: pkg.key,
  title: pkg.json.name ?? (pkg.key === "." ? workspace.split("/").at(-1) ?? pkg.key : pkg.key),
  detail: pkg.key === "." ? "Root" : pkg.key,
  icon: "sf:shippingbox",
  resource: pkg.file,
  actions: [
    {
      command: "npm.install",
      title: "Install Dependencies",
      icon: "codicon:package",
      run: Effect.succeed(
        new RunTask({
          name: "install",
          command: pkg.manager,
          args: ["install"],
          cwd: pkg.dir,
        }),
      ),
    },
    openAt(pkg.file, undefined, "Open package.json"),
  ],
});
