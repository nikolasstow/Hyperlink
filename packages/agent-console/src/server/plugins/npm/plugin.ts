/**
 * NPM: the workspace's packages and their scripts.
 *
 * Its own backend, not VS Code's npm extension: every package.json in the
 * workspace (dependency folders and build output skipped), each with its
 * scripts. A script runs with the package's own package manager, from its
 * `packageManager` field or else the nearest lockfile, as the package's
 * maintainers would run it.
 *
 * @internal
 */
import { Effect, FileSystem, Option, Path, Schema } from "effect";
import { definePlugin, OpenFile, PluginError, RunTask, type PluginAction, type PluginNode } from "../../plugin/api";

/** Folders never searched for packages. */
const skipped = new Set(["node_modules", ".git", "dist", "build", ".next", ".expo", ".turbo", "coverage", "repos", "archive", "ios", "android", "Pods"]);

/** How deep the search for packages goes. */
const maxDepth = 6;

const packageJson = Schema.Struct({
  name: Schema.optionalKey(Schema.String),
  packageManager: Schema.optionalKey(Schema.String),
  scripts: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
});

/** Lockfiles and the package manager each belongs to, most specific first. */
const lockfiles: ReadonlyArray<readonly [string, string]> = [
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"],
  ["package-lock.json", "npm"],
];

const failed = (message: string) => (cause: unknown) =>
  new PluginError({
    message: `${message}: ${cause instanceof Error ? cause.message : String(cause)}`,
  });

/** Every package.json under `dir`, in path order. An unreadable folder is
 * skipped, as a file search skips what it cannot list. */
const findPackages = (dir: string, depth: number): Effect.Effect<ReadonlyArray<string>, never, FileSystem.FileSystem | Path.Path> =>
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

/** The package manager for the package in `dir`: its `packageManager` field,
 * else the nearest lockfile at or above it, else npm. The search goes past
 * the workspace: a package inside a monorepo is managed by the root's
 * lockfile, which is how package managers find their workspace root too. */
const packageManagerFor = (dir: string, declared: string | undefined) =>
  Effect.gen(function* () {
    if (declared !== undefined) return declared.split("@")[0] ?? "npm";
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

/** The 1-based line of `script` inside the `scripts` block of package.json. */
const scriptLine = (text: string, script: string): number | undefined => {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => /"scripts"\s*:/.test(line));
  if (start < 0) return undefined;
  const quoted = `"${script.replaceAll('"', '\\"')}"`;
  const offset = lines.slice(start + 1).findIndex((line) => new RegExp(`${quoted.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:`).test(line));
  return offset < 0 ? undefined : start + 2 + offset;
};

const openAt = (file: string, line: number | undefined, title: string): PluginAction => ({
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

/** One package.json as a node: its scripts below it. Open on arrival only
 * when it is the workspace's only package; a monorepo's dozens of packages
 * (hundreds of scripts) arrive as a list of packages to open. */
const packageNode = (file: string, workspace: string, only: boolean) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const text = yield* fs.readFileString(file).pipe(Effect.mapError(failed(`reading ${file}`)));
    const pkg = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(packageJson))(text).pipe(Effect.mapError(failed(`${file} is not a package.json`)));
    const dir = path.dirname(file);
    const manager = yield* packageManagerFor(dir, pkg.packageManager);
    const relative = path.relative(workspace, file);
    const scripts = Object.entries(pkg.scripts ?? {}).map(
      ([name, command]): PluginNode => ({
        key: name,
        label: name,
        description: command,
        tooltip: `${manager} run ${name}`,
        icon: "codicon:terminal",
        open: openAt(file, scriptLine(text, name), "Edit Script"),
        actions: [
          {
            command: "npm.run",
            title: "Run",
            icon: "codicon:run",
            inline: true,
            run: Effect.succeed(
              new RunTask({
                name,
                command: manager,
                args: ["run", name],
                cwd: dir,
              }),
            ),
          },
          openAt(file, scriptLine(text, name), "Open"),
        ],
      }),
    );
    const node: PluginNode = {
      key: relative,
      label: relative,
      ...(pkg.name === undefined ? {} : { description: pkg.name }),
      icon: "codicon:file",
      resource: file,
      expanded: only,
      open: openAt(file, undefined, "Open"),
      actions: [
        {
          command: "npm.install",
          title: "Install Dependencies",
          icon: "codicon:package",
          run: Effect.succeed(
            new RunTask({
              name: "install",
              command: manager,
              args: ["install"],
              cwd: dir,
            }),
          ),
        },
        openAt(file, undefined, "Open"),
      ],
      children: scripts,
    };
    return node;
  });

export default definePlugin({
  views: {
    npm: {
      tree: ({ workspace }) =>
        findPackages(workspace, 0).pipe(Effect.flatMap((files) => Effect.forEach(files, (file) => packageNode(file, workspace, files.length === 1)))),
    },
  },
});
