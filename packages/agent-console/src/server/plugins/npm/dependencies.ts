/**
 * Packages: the workspace's dependencies as a collection, a package manager
 * in the app (§23.2).
 *
 * Each workspace package is a group; each dependency is an item in the
 * category of its kind (dependencies, dev, peer, optional), with the version
 * installed beside the range asked for. Tapping one opens it on npmjs.com;
 * its menu updates or removes it. Install is the collection's form, and
 * search reaches the npm registry, so a package not installed yet can be
 * installed from its result.
 *
 * Every change runs the package's own package manager in that package's
 * folder, through the process runner.
 *
 * @internal
 */
import { Effect, FileSystem, Path, Schema } from "effect";
import { OpenUrl, PluginError, RunTask, type PluginAction, type PluginCategory, type PluginCollection, type PluginForm, type PluginItem } from "../../plugin/api";
import { packageUrl, searchRegistry, type RegistryPackage } from "./registry";
import { packageGroup, packagesIn, valueOf, type Package } from "./workspace";

/** A kind of dependency, as package.json names it and as a category. */
interface Kind {
  readonly field: "dependencies" | "devDependencies" | "peerDependencies" | "optionalDependencies";
  readonly category: string;
  readonly name: string;
  readonly icon: string;
}

const kinds: ReadonlyArray<Kind> = [
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

const viewOnNpm = (name: string): PluginAction => ({
  command: "npm.view",
  title: "View on npm",
  icon: "sf:safari",
  run: Effect.succeed(new OpenUrl({ url: packageUrl(name) })),
});

const installedVersionSchema = Schema.fromJsonString(Schema.Struct({ version: Schema.String }));

/** The version installed for `pkg`, if it is installed where its package
 * manager puts it for that package. */
const installedVersion = (pkg: Package, name: string) =>
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

const dependencyItem = (pkg: Package, kind: Kind, name: string, range: string) =>
  installedVersion(pkg, name).pipe(
    Effect.map(
      (installed): PluginItem => ({
        key: `${pkg.key}#${kind.field}#${name}`,
        title: name,
        name: range,
        detail: installed === undefined ? "Not installed" : `Installed ${installed}`,
        icon: "sf:shippingbox",
        group: pkg.key,
        categories: [kind.category],
        open: viewOnNpm(name),
        actions: [
          {
            command: "npm.update",
            title: "Update",
            icon: "codicon:refresh",
            run: Effect.succeed(task(pkg, `update ${name}`, [verbs(pkg.manager).update, name])),
          },
          {
            command: "npm.remove",
            title: "Remove",
            icon: "codicon:trash",
            run: Effect.succeed(task(pkg, `remove ${name}`, [verbs(pkg.manager).remove, name])),
          },
          viewOnNpm(name),
        ],
      }),
    ),
  );

/** Install a package into one of the workspace's packages, found again on
 * submit so its package manager is the one it has now. */
const installForm = (workspace: string, keys: ReadonlyArray<string>, name: string, command: string): PluginForm => ({
  command,
  title: name.length === 0 ? "Install Package" : `Install ${name}`,
  icon: "codicon:add",
  submitTitle: "Install",
  fields: [
    {
      id: "package",
      label: "Into",
      kind: "group",
      value: keys.includes(".") ? "." : (keys[0] ?? "."),
    },
    {
      id: "name",
      label: "Package",
      kind: "code",
      value: name,
      placeholder: "zod",
    },
    {
      id: "version",
      label: "Version",
      kind: "code",
      value: "",
      placeholder: "latest",
    },
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
      const requested = (yield* valueOf(values, "name")).trim();
      const version = (yield* valueOf(values, "version")).trim();
      const category = yield* valueOf(values, "kind");
      if (requested.length === 0) return yield* new PluginError({ message: "say which package to install" });
      if (/\s/.test(requested) || /\s/.test(version)) return yield* new PluginError({ message: "a package name and version have no spaces" });
      const packages = yield* packagesIn(workspace);
      const pkg = packages.find((candidate) => candidate.key === key);
      if (pkg === undefined) return yield* new PluginError({ message: `there is no package at ${key}` });
      const spec = version.length === 0 ? requested : `${requested}@${version}`;
      return task(pkg, `install ${spec}`, [verbs(pkg.manager).add, spec, ...kindFlag(pkg.manager, category)]);
    }),
});

const searchResult = (workspace: string, keys: ReadonlyArray<string>, found: RegistryPackage): PluginItem => ({
  key: `npm:${found.name}`,
  title: found.name,
  name: found.version,
  ...(found.description === undefined ? {} : { detail: found.description }),
  icon: "sf:shippingbox",
  group: "",
  categories: [],
  open: viewOnNpm(found.name),
  actions: [viewOnNpm(found.name)],
  forms: [installForm(workspace, keys, found.name, "npm.install")],
});

const dependenciesOf = (pkg: Package) =>
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
              "npm.install",
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
