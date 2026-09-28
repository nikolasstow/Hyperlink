/**
 * NPM: the repo's package.json, its packages, and their scripts
 * (docs/handoffs/double-agent-repo-screen-and-plugin-system.md §23).
 *
 * - The **NPM** page summarizes the root package.json: the project, its
 *   package manager and version, and the workspace in numbers, with the
 *   plugin's other pages below.
 * - **Scripts** is every package's scripts as a collection: packages are its
 *   groups, and each script goes in the categories its name and command
 *   suggest (scripts.ts) until the user sorts it. A script runs with its
 *   package's own package manager; editing, duplicating and adding one
 *   rewrite only package.json's `scripts` (packageJson.ts).
 *
 * Packages are every package.json in the workspace, with dependency folders
 * and build output skipped. A package's manager is its `packageManager`
 * field, else the nearest lockfile, as the package's maintainers would run it.
 *
 * @internal
 */
import { Effect, FileSystem, Option, Path, Schema } from "effect";
import { Completed, definePlugin, OpenFile, PluginError, RunTask, type PluginAction, type PluginForm, type PluginFormField, type PluginGroup, type PluginItem, type PluginSummaryRow } from "../../plugin/api";
import { changeScripts, readScripts, writeScripts, type ScriptChange } from "./packageJson";
import { categorize, scriptCategories, titleOf } from "./scripts";

/** Folders never searched for packages. */
const skipped = new Set(["node_modules", ".git", "dist", "build", ".next", ".expo", ".turbo", "coverage", "repos", "archive", "ios", "android", "Pods"]);

/** How deep the search for packages goes. */
const maxDepth = 6;

const packageJson = Schema.Struct({
  name: Schema.optionalKey(Schema.String),
  version: Schema.optionalKey(Schema.String),
  description: Schema.optionalKey(Schema.String),
  license: Schema.optionalKey(Schema.String),
  private: Schema.optionalKey(Schema.Boolean),
  packageManager: Schema.optionalKey(Schema.String),
  engines: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  dependencies: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  devDependencies: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
});
const packageJsonText = Schema.fromJsonString(packageJson);

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

/** A declared `packageManager` (`pnpm@10.33.4+sha512…`) as name and version. */
const declaredManager = (declared: string) => {
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
const packageManagerFor = (dir: string, declared: string | undefined) =>
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
interface Package {
  readonly file: string;
  readonly dir: string;
  readonly key: string;
  readonly text: string;
  readonly json: typeof packageJson.Type;
  readonly scripts: ReadonlyArray<readonly [string, string]>;
  readonly manager: string;
}

const readPackage = (file: string, workspace: string) =>
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

const packagesIn = (workspace: string) => findPackages(workspace, 0).pipe(Effect.flatMap((files) => Effect.forEach(files, (file) => readPackage(file, workspace))));

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

/** Apply a change to the scripts of the package.json at `file`, as it is on
 * disk now. */
const changeScriptsIn = (file: string, change: ScriptChange) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const text = yield* fs.readFileString(file).pipe(Effect.mapError(failed(`reading ${file}`)));
    const scripts = yield* readScripts(text);
    const next = yield* changeScripts(scripts, change);
    const written = yield* writeScripts(text, next);
    yield* fs.writeFileString(file, written).pipe(Effect.mapError(failed(`writing ${file}`)));
    return new Completed({ messages: [] });
  }).pipe(Effect.mapError((cause) => (cause instanceof PluginError ? cause : new PluginError({ message: cause.message }))));

/** A form value, or a failure naming the field that is missing. */
const valueOf = (values: Readonly<Record<string, string>>, field: string) => {
  const value = values[field];
  return value === undefined ? Effect.fail(new PluginError({ message: `the form has no ${field}` })) : Effect.succeed(value);
};

const nameAndCommand = (values: Readonly<Record<string, string>>) => Effect.all([valueOf(values, "name"), valueOf(values, "command")]);

/** The first `<name>-copy`, `<name>-copy-2`, … no script has yet. */
const copyName = (name: string, taken: ReadonlySet<string>): string => {
  const candidates = [`${name}-copy`, ...Array.from({ length: 98 }, (_, index) => `${name}-copy-${index + 2}`)];
  return candidates.find((candidate) => !taken.has(candidate)) ?? `${name}-copy`;
};

const scriptFields = (name: string, command: string): ReadonlyArray<PluginFormField> => [
  {
    id: "name",
    label: "Name",
    kind: "code",
    value: name,
    placeholder: "build:ios",
  },
  {
    id: "command",
    label: "Command",
    kind: "code",
    value: command,
    placeholder: "tsc -b",
  },
];

const scriptItem = (pkg: Package, name: string, command: string): PluginItem => {
  const names = new Set(pkg.scripts.map(([existing]) => existing));
  const edit: PluginForm = {
    command: "npm.edit",
    title: "Edit Script",
    icon: "codicon:edit",
    fields: scriptFields(name, command),
    submit: (values) =>
      nameAndCommand(values).pipe(
        Effect.flatMap(([next, nextCommand]) =>
          changeScriptsIn(pkg.file, {
            previous: name,
            name: next,
            command: nextCommand,
          }),
        ),
      ),
  };
  const duplicate: PluginForm = {
    command: "npm.duplicate",
    title: "Duplicate",
    icon: "sf:plus.square.on.square",
    submitTitle: "Add",
    fields: scriptFields(copyName(name, names), command),
    submit: (values) =>
      nameAndCommand(values).pipe(
        Effect.flatMap(([next, nextCommand]) =>
          changeScriptsIn(pkg.file, {
            name: next,
            command: nextCommand,
          }),
        ),
      ),
  };
  return {
    key: `${pkg.key}#${name}`,
    title: titleOf(name, names),
    name,
    detail: command,
    icon: "codicon:terminal",
    group: pkg.key,
    categories: categorize(name, command),
    run: {
      command: "npm.run",
      title: "Run",
      icon: "codicon:run",
      run: Effect.succeed(
        new RunTask({
          name,
          command: pkg.manager,
          args: ["run", name],
          cwd: pkg.dir,
        }),
      ),
    },
    actions: [openAt(pkg.file, scriptLine(pkg.text, name), "Open in package.json")],
    forms: [edit, duplicate],
  };
};

const packageGroup = (pkg: Package, workspace: string): PluginGroup => ({
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

/** Add a script to a package, found again on submit so it is the file as it
 * is now. */
const addScript = (workspace: string, keys: ReadonlyArray<string>): PluginForm => ({
  command: "npm.add",
  title: "New Script",
  icon: "codicon:add",
  submitTitle: "Add",
  fields: [
    {
      id: "package",
      label: "Package",
      kind: "group",
      value: keys.includes(".") ? "." : (keys[0] ?? "."),
    },
    ...scriptFields("", ""),
  ],
  submit: (values) =>
    Effect.gen(function* () {
      const key = yield* valueOf(values, "package");
      const [name, command] = yield* nameAndCommand(values);
      const packages = yield* packagesIn(workspace);
      const pkg = packages.find((candidate) => candidate.key === key);
      if (pkg === undefined) return yield* new PluginError({ message: `there is no package at ${key}` });
      return yield* changeScriptsIn(pkg.file, {
        name,
        command,
      });
    }),
});

const count = (record: Readonly<Record<string, string>> | undefined) => Object.keys(record ?? {}).length;

const summary = (workspace: string) =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const packages = yield* packagesIn(workspace);
    const root = packages.find((pkg) => pkg.key === ".");
    if (root === undefined && packages.length === 0) {
      return {
        sections: [],
        resources: [],
      };
    }
    const declared = root?.json.packageManager === undefined ? undefined : declaredManager(root.json.packageManager);
    const manager = declared?.name ?? (yield* packageManagerFor(workspace, undefined));
    const row = (label: string, value: string, mono = false): PluginSummaryRow => ({
      label,
      value,
      mono,
    });
    const optional = (label: string, value: string | undefined, mono = false): ReadonlyArray<PluginSummaryRow> => (value === undefined ? [] : [row(label, value, mono)]);
    const project: ReadonlyArray<PluginSummaryRow> =
      root === undefined
        ? []
        : [
            row("Name", root.json.name ?? path.basename(workspace)),
            ...optional("Version", root.json.version, true),
            ...optional("Description", root.json.description),
            ...optional("License", root.json.license),
            ...optional("Private", root.json.private === true ? "Yes" : undefined),
          ];
    return {
      // The page is named for the repo's own package manager.
      title: manager.toUpperCase(),
      sections: [
        ...(project.length === 0 ? [] : [{ rows: project }]),
        {
          title: "Package Manager",
          rows: [
            row("Manager", manager),
            row("Version", declared?.version ?? "Not pinned", declared?.version !== undefined),
            ...optional("Node", root?.json.engines?.["node"], true),
          ],
        },
        {
          title: "Workspace",
          rows: [
            ...(packages.length > 1 ? [row("Packages", String(packages.length))] : []),
            row("Scripts", String(packages.reduce((total, pkg) => total + pkg.scripts.length, 0))),
            ...(root === undefined ? [] : [row("Dependencies", String(count(root.json.dependencies))), row("Dev Dependencies", String(count(root.json.devDependencies)))]),
          ],
        },
      ],
      resources: packages.map((pkg) => pkg.file),
    };
  });

export default definePlugin({
  summaries: {
    npm: {
      summary: ({ workspace }) => summary(workspace),
    },
  },
  collections: {
    scripts: {
      categories: scriptCategories,
      groupsTitle: "Packages",
      content: ({ workspace }) =>
        packagesIn(workspace).pipe(
          Effect.map((packages) => ({
            groups: packages.map((pkg) => packageGroup(pkg, workspace)),
            items: packages.flatMap((pkg) => pkg.scripts.map(([name, command]) => scriptItem(pkg, name, command))),
            create: addScript(
              workspace,
              packages.map((pkg) => pkg.key),
            ),
          })),
        ),
    },
  },
});
