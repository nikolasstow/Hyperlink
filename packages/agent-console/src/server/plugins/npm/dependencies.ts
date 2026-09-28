/**
 * Packages: the workspace's dependencies as a collection, a package manager
 * in the app (§23.2), and what a dependency's own page and the install forms
 * are built from.
 *
 * Each workspace package is a group; each dependency is an item in the
 * category of its kind (dependencies, dev, peer, optional), with the version
 * installed beside the range asked for. Tapping one opens its page; its menu
 * updates, uninstalls, or opens it on npmjs.com. Install is the collection's
 * form, and search reaches the npm registry, so a package not installed yet
 * can be installed from its result.
 *
 * Every change runs the package's own package manager in that package's
 * folder, through the process runner.
 *
 * @internal
 */
import { Effect, FileSystem, Path, Schema } from "effect";
import {
  OpenUrl,
  PluginError,
  RunTask,
  type PluginAction,
  type PluginCategory,
  type PluginCollection,
  type PluginForm,
  type PluginFormField,
  type PluginItem,
} from "../../plugin/api";
import { packageUrl, searchRegistry, type RegistryPackage } from "./registry";
import { packageGroup, packagesIn, valueOf, type Package } from "./workspace";

/** A kind of dependency, as package.json names it and as a category. */
export interface Kind {
  readonly field: "dependencies" | "devDependencies" | "peerDependencies" | "optionalDependencies";
  readonly category: string;
  readonly name: string;
  readonly icon: string;
}

export const kinds: ReadonlyArray<Kind> = [
  {
    field: "dependencies",
    category: "dependencies",
    name: "Dependencies",
    icon: "sf:shippingbox",
  },
  {
    field: "devDependencies",
    category: "dev",
    name: "Dev Dependencies",
    icon: "sf:hammer",
  },
  {
    field: "peerDependencies",
    category: "peer",
    name: "Peer Dependencies",
    icon: "sf:link",
  },
  {
    field: "optionalDependencies",
    category: "optional",
    name: "Optional Dependencies",
    icon: "sf:questionmark.circle",
  },
];

export const kindByField = (field: string): Kind | undefined => kinds.find((kind) => kind.field === field);

export const kindByCategory = (category: string): Kind | undefined => kinds.find((kind) => kind.category === category);

export const dependencyCategories: ReadonlyArray<PluginCategory> = kinds.map((kind) => ({
  id: kind.category,
  name: kind.name,
  icon: kind.icon,
}));

/** Each package manager's words for adding, removing and updating. */
const verbs = (manager: string) => {
  switch (manager) {
    case "npm":
      return {
        add: "install",
        remove: "uninstall",
        update: "update",
        dev: "--save-dev",
        peer: "--save-peer",
        optional: "--save-optional",
      };
    case "yarn":
      return {
        add: "add",
        remove: "remove",
        update: "up",
        dev: "--dev",
        peer: "--peer",
        optional: "--optional",
      };
    case "bun":
      return {
        add: "add",
        remove: "remove",
        update: "update",
        dev: "--dev",
        peer: "--peer",
        optional: "--optional",
      };
    default:
      return {
        add: "add",
        remove: "remove",
        update: "update",
        dev: "--save-dev",
        peer: "--save-peer",
        optional: "--save-optional",
      };
  }
};

const kindFlag = (manager: string, category: string): ReadonlyArray<string> => {
  const words = verbs(manager);
  return category === "dev" ? [words.dev] : category === "peer" ? [words.peer] : category === "optional" ? [words.optional] : [];
};

const task = (pkg: Package, name: string, args: ReadonlyArray<string>) =>
  new RunTask({
    name,
    command: pkg.manager,
    args,
    cwd: pkg.dir,
  });

/** Adding to a pnpm workspace's root package needs saying so (`-w`); pnpm
 * refuses otherwise, to keep root installs deliberate. */
const rootFlag = (pkg: Package) =>
  Effect.gen(function* () {
    if (pkg.manager !== "pnpm") return [];
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const workspaceRoot = yield* fs.exists(path.join(pkg.dir, "pnpm-workspace.yaml")).pipe(Effect.orElseSucceed(() => false));
    return workspaceRoot ? ["--workspace-root"] : [];
  });

/** Add `spec` (a name, or name@version) to `pkg` as `category`. */
export const addTask = (pkg: Package, spec: string, category: string) =>
  rootFlag(pkg).pipe(Effect.map((root) => task(pkg, `install ${spec}`, [verbs(pkg.manager).add, spec, ...kindFlag(pkg.manager, category), ...root])));

export const viewOnNpm = (name: string): PluginAction => ({
  command: "npm.view",
  title: "View on npm",
  icon: "sf:safari",
  run: Effect.succeed(new OpenUrl({ url: packageUrl(name) })),
});

/**
 * What can be done with a dependency: update it to `latest` (rewriting its
 * range, as the package manager's add does), update it within its range,
 * uninstall it, and view it on npm.
 */
export const dependencyActions = (pkg: Package, kind: Kind, name: string, latest: string | undefined): ReadonlyArray<PluginAction> => [
  ...(latest === undefined
    ? []
    : [
        {
          command: "npm.updateLatest",
          title: `Update to ${latest}`,
          icon: "codicon:refresh",
          run: addTask(pkg, `${name}@${latest}`, kind.category),
        },
      ]),
  {
    command: "npm.update",
    title: "Update Within Range",
    icon: "codicon:refresh",
    run: Effect.succeed(task(pkg, `update ${name}`, [verbs(pkg.manager).update, name])),
  },
  {
    command: "npm.remove",
    title: "Uninstall",
    icon: "codicon:trash",
    destructive: true,
    run: Effect.succeed(task(pkg, `uninstall ${name}`, [verbs(pkg.manager).remove, name])),
  },
  viewOnNpm(name),
];

const installedVersionSchema = Schema.fromJsonString(Schema.Struct({ version: Schema.String }));

/** The version installed for `pkg`, if it is installed where its package
 * manager puts it for that package. */
export const installedVersion = (pkg: Package, name: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    return yield* fs.readFileString(path.join(pkg.dir, "node_modules", name, "package.json")).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(installedVersionSchema)),
      Effect.map((installed): string | undefined => installed.version),
      // Not there is an answer here ("not installed"), not a failure.
      Effect.orElseSucceed((): string | undefined => undefined),
    );
  });

/** The params of a dependency's own page. */
export const dependencyParams = (pkg: Package, kind: Kind, name: string): Readonly<Record<string, string>> => ({
  package: pkg.key,
  kind: kind.field,
  name,
});

const dependencyItem = (pkg: Package, kind: Kind, name: string, range: string) =>
  installedVersion(pkg, name).pipe(
    Effect.map(
      (installed): PluginItem => ({
        key: `${pkg.key}#${kind.field}#${name}`,
        title: name,
        name: range,
        detail: installed === undefined ? "Not installed" : `Installed ${installed}`,
        group: pkg.key,
        categories: [kind.category],
        opens: {
          page: "dependency",
          params: dependencyParams(pkg, kind, name),
          title: name,
        },
        actions: dependencyActions(pkg, kind, name, undefined),
      }),
    ),
  );

/** Find a workspace package again, as it is on disk now. */
export const packageAt = (workspace: string, key: string) =>
  packagesIn(workspace).pipe(
    Effect.flatMap((packages) => {
      const pkg = packages.find((candidate) => candidate.key === key);
      return pkg === undefined ? Effect.fail(new PluginError({ message: `there is no package at ${key}` })) : Effect.succeed(pkg);
    }),
  );

/** The spec to install from a form's name and version, checked. */
const specOf = (values: Readonly<Record<string, string>>) =>
  Effect.gen(function* () {
    const requested = (yield* valueOf(values, "name")).trim();
    const version = (yield* valueOf(values, "version")).trim();
    if (requested.length === 0) return yield* new PluginError({ message: "say which package to install" });
    if (/\s/.test(requested) || /\s/.test(version)) return yield* new PluginError({ message: "a package name and version have no spaces" });
    return version.length === 0 ? requested : `${requested}@${version}`;
  });

const nameField = (name: string): PluginFormField => ({
  id: "name",
  label: "Package",
  kind: "code",
  value: name,
  placeholder: "zod",
});

const versionField: PluginFormField = {
  id: "version",
  label: "Version",
  kind: "code",
  value: "",
  placeholder: "latest",
};

/** Install into a package the form asks for, as the kind it asks for. */
const installForm = (workspace: string, keys: ReadonlyArray<string>, name: string): PluginForm => ({
  command: "npm.install",
  title: name.length === 0 ? "Add Package" : `Add ${name}`,
  icon: "sf:shippingbox",
  submitTitle: "Add",
  fields: [
    {
      id: "package",
      label: "Into",
      kind: "group",
      value: keys.includes(".") ? "." : (keys[0] ?? "."),
    },
    nameField(name),
    versionField,
    {
      id: "kind",
      label: "As",
      kind: "choice",
      value: "dependencies",
      options: kinds.map((kind) => ({
        value: kind.category,
        label: kind.name,
      })),
    },
  ],
  submit: (values) =>
    Effect.gen(function* () {
      const key = yield* valueOf(values, "package");
      const category = yield* valueOf(values, "kind");
      const spec = yield* specOf(values);
      const pkg = yield* packageAt(workspace, key);
      return yield* addTask(pkg, spec, category);
    }),
});

/** Install into one package as one kind: a page's Install Dependency and
 * Install Dev Dependency. */
export const installIntoForm = (workspace: string, key: string, kind: Kind, command: string, title: string): PluginForm => ({
  command,
  title,
  icon: kind.icon,
  submitTitle: "Add",
  fields: [nameField(""), versionField],
  submit: (values) =>
    Effect.gen(function* () {
      const spec = yield* specOf(values);
      const pkg = yield* packageAt(workspace, key);
      return yield* addTask(pkg, spec, kind.category);
    }),
});

const searchResult = (workspace: string, keys: ReadonlyArray<string>, found: RegistryPackage): PluginItem => ({
  key: `npm:${found.name}`,
  title: found.name,
  name: found.version,
  ...(found.description === undefined ? {} : { detail: found.description }),
  group: "",
  categories: [],
  open: viewOnNpm(found.name),
  actions: [viewOnNpm(found.name)],
  forms: [installForm(workspace, keys, found.name)],
});

export const dependenciesOf = (pkg: Package) =>
  Effect.forEach(kinds, (kind) => Effect.forEach(Object.entries(pkg.json[kind.field] ?? {}), ([name, range]) => dependencyItem(pkg, kind, name, range))).pipe(
    Effect.map((byKind) => byKind.flat()),
  );

export const dependenciesCollection: PluginCollection = {
  categories: dependencyCategories,
  groupsTitle: "Workspace",
  content: ({ workspace }) =>
    packagesIn(workspace).pipe(
      Effect.flatMap((packages) =>
        Effect.forEach(packages, dependenciesOf).pipe(
          Effect.map((items) => ({
            groups: packages.map((pkg) => packageGroup(pkg, workspace)),
            items: items.flat(),
            create: installForm(
              workspace,
              packages.map((pkg) => pkg.key),
              "",
            ),
          })),
        ),
      ),
    ),
  search: {
    placeholder: "Search packages",
    inCollection: "Installed",
    beyond: "Not Installed",
    run: ({ workspace }, query) =>
      query.trim().length === 0
        ? Effect.succeed([])
        : Effect.all([packagesIn(workspace), searchRegistry(query.trim(), 20)]).pipe(
            Effect.map(([packages, found]) =>
              found.map((result) =>
                searchResult(
                  workspace,
                  packages.map((pkg) => pkg.key),
                  result,
                ),
              ),
            ),
          ),
  },
};
