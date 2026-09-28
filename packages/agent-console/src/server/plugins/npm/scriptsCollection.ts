/**
 * Scripts: every package's scripts as a collection (§23.3). Packages are its
 * groups, and each script goes in the categories its name and command suggest
 * (scripts.ts) until the user sorts it. A script runs with its package's own
 * package manager; editing, duplicating and adding one rewrite only
 * package.json's `scripts` (packageJson.ts).
 *
 * @internal
 */
import { Effect, FileSystem } from "effect";
import { Completed, PluginError, RunTask, type PluginCollection, type PluginForm, type PluginFormField, type PluginItem } from "../../plugin/api";
import { changeScripts, readScripts, writeScripts, type ScriptChange } from "./packageJson";
import { categorize, scriptCategories, titleOf } from "./scripts";
import { failed, openAt, packageGroup, packagesIn, scriptLine, valueOf, type Package } from "./workspace";

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

/** Add a script to a package, found again on submit so it is the file as it
 * is now. */
const addScript = (workspace: string, keys: ReadonlyArray<string>): PluginForm => ({
  command: "npm.add",
  title: "Add Script",
  icon: "codicon:terminal",
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

export const scriptsCollection: PluginCollection = {
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
};
