/**
 * The NPM page and its details page (§23.1).
 *
 * The NPM page, titled for the repo's package manager (PNPM in a pnpm repo),
 * top to bottom: the root package's name, version and description with a
 * button to all its details; the pinned scripts with a button to all of them;
 * and the package manager's card, which opens Packages, says what is
 * installed, and offers the package manager's own update when there is one.
 *
 * @internal
 */
import { Effect, Path, Predicate } from "effect";
import { RunTask, type PluginAction, type PluginBlock, type PluginSectionRow, type PluginSectionsContent } from "../../plugin/api";
import { latestVersion } from "./registry";
import { declaredManager, packageManagerFor, packagesIn, type Package } from "./workspace";

const row = (label: string, value: string, options: { readonly mono?: boolean; readonly stacked?: boolean } = {}): PluginSectionRow => ({
  label,
  value,
  mono: options.mono === true,
  stacked: options.stacked === true,
});

const optional = (label: string, value: string | undefined, options: { readonly mono?: boolean; readonly stacked?: boolean } = {}): ReadonlyArray<PluginSectionRow> =>
  value === undefined || value.length === 0 ? [] : [row(label, value, options)];

const count = (record: Readonly<Record<string, string>> | undefined) => Object.keys(record ?? {}).length;

/** A package.json field that is a string or an object with a name or url
 * (`author`, `repository`), as text. */
const personOrLink = (value: unknown): string | undefined => {
  if (Predicate.isString(value)) return value;
  if (Predicate.hasProperty(value, "url") && Predicate.isString(value.url)) return value.url;
  if (Predicate.hasProperty(value, "name") && Predicate.isString(value.name)) return value.name;
  return undefined;
};

/** `workspaces` is a list, or an object with `packages`. */
const workspaceGlobs = (value: unknown): string | undefined => {
  const list = Array.isArray(value) ? value : Predicate.hasProperty(value, "packages") && Array.isArray(value.packages) ? value.packages : undefined;
  return list === undefined ? undefined : list.filter(Predicate.isString).join("\n");
};

/** The package manager's own update: the command each uses to update itself. */
const selfUpdate = (manager: string): ReadonlyArray<string> =>
  manager === "npm" ? ["install", "--global", "npm@latest"] : manager === "yarn" ? ["set", "version", "latest"] : manager === "bun" ? ["upgrade"] : ["self-update"];

/** Direct dependencies across the workspace, each name once. */
const uniqueDependencies = (packages: ReadonlyArray<Package>, field: "dependencies" | "devDependencies") =>
  new Set(packages.flatMap((pkg) => Object.keys(pkg.json[field] ?? {}))).size;

const managerCard = (workspace: string, packages: ReadonlyArray<Package>, root: Package | undefined) =>
  Effect.gen(function* () {
    const declared = root?.json.packageManager === undefined ? undefined : declaredManager(root.json.packageManager);
    const manager = declared?.name ?? (yield* packageManagerFor(workspace, undefined));
    // The registry being out of reach costs only the update check; the card
    // says so rather than leaving the row out.
    const latest = yield* latestVersion(manager).pipe(
      Effect.map((version) => ({ version })),
      Effect.catch((error) => Effect.succeed({ error: error.message })),
    );
    const latestKnown = "version" in latest ? latest.version : undefined;
    const outdated = latestKnown !== undefined && declared?.version !== undefined && latestKnown !== declared.version;
    const update: ReadonlyArray<PluginAction> =
      outdated && root !== undefined
        ? [
            {
              command: "npm.selfUpdate",
              title: `Update to ${latestKnown}`,
              icon: "codicon:refresh",
              run: Effect.succeed(
                new RunTask({
                  name: `update ${manager}`,
                  command: manager,
                  args: selfUpdate(manager),
                  cwd: root.dir,
                }),
              ),
            },
          ]
        : [];
    const block: PluginBlock = {
      _tag: "Card",
      key: "manager",
      title: manager,
      icon: "sf:shippingbox",
      rows: [
        row("Version", declared?.version ?? "Not pinned", { mono: declared?.version !== undefined }),
        "version" in latest ? row("Latest", latest.version, { mono: true }) : row("Latest", `Couldn’t check: ${latest.error}`),
        row("Dependencies", String(uniqueDependencies(packages, "dependencies"))),
        row("Dev Dependencies", String(uniqueDependencies(packages, "devDependencies"))),
        ...(packages.length > 1 ? [row("Workspace Packages", String(packages.length))] : []),
      ],
      opens: "packages",
      actions: update,
    };
    return {
      manager,
      block,
    };
  });

export const npmPage = (workspace: string) =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const packages = yield* packagesIn(workspace);
    const root = packages.find((pkg) => pkg.key === ".");
    if (root === undefined && packages.length === 0) {
      const nothing: PluginSectionsContent = {
        blocks: [],
        resources: [],
      };
      return nothing;
    }
    const card = yield* managerCard(workspace, packages, root);
    const about: ReadonlyArray<PluginBlock> =
      root === undefined
        ? []
        : [
            {
              _tag: "Facts",
              rows: [
                row("Name", root.json.name ?? path.basename(workspace)),
                ...optional("Version", root.json.version, { mono: true }),
                ...optional("Description", root.json.description, { stacked: true }),
              ],
            },
            {
              _tag: "Link",
              page: "details",
              title: "All Details",
              icon: "sf:info.circle",
            },
          ];
    const content: PluginSectionsContent = {
      // The page is named for the repo's own package manager.
      title: card.manager.toUpperCase(),
      blocks: [
        ...about,
        {
          _tag: "Pinned",
          collection: "scripts",
          title: "Pinned Scripts",
          viewAll: "View All Scripts",
          empty: "Pin a script from its menu to keep it here.",
        },
        card.block,
      ],
      resources: packages.map((pkg) => pkg.file),
    };
    return content;
  });

/** Everything the root package.json says about the project. */
export const detailsPage = (workspace: string) =>
  packagesIn(workspace).pipe(
    Effect.map((packages): PluginSectionsContent => {
      const root = packages.find((pkg) => pkg.key === ".");
      if (root === undefined) {
        return {
          blocks: [],
          resources: [],
        };
      }
      const { json } = root;
      const facts = (title: string, rows: ReadonlyArray<PluginSectionRow>): ReadonlyArray<PluginBlock> => (rows.length === 0 ? [] : [{ _tag: "Facts", title, rows }]);
      return {
        blocks: [
          ...facts("Project", [
            ...optional("Name", json.name),
            ...optional("Version", json.version, { mono: true }),
            ...optional("Description", json.description, { stacked: true }),
            ...optional("License", json.license),
            ...optional("Author", personOrLink(json.author)),
            ...optional("Homepage", json.homepage, { stacked: true }),
            ...optional("Repository", personOrLink(json.repository), { stacked: true }),
            ...optional("Keywords", json.keywords?.join(", "), { stacked: true }),
            ...(json.private === true ? [row("Private", "Yes")] : []),
          ]),
          ...facts("Modules", [
            ...optional("Type", json.type, { mono: true }),
            ...optional("Main", json.main, { mono: true }),
            ...optional("Module", json.module, { mono: true }),
            ...optional("Types", json.types, { mono: true }),
          ]),
          ...facts("Tooling", [
            ...optional("Package Manager", json.packageManager, { mono: true, stacked: true }),
            ...Object.entries(json.engines ?? {}).map(([engine, range]) => row(`Engine: ${engine}`, range, { mono: true })),
            ...optional("Workspaces", workspaceGlobs(json.workspaces), { mono: true, stacked: true }),
          ]),
          ...facts("Contents", [
            row("Scripts", String(root.scripts.length)),
            row("Dependencies", String(count(json.dependencies))),
            row("Dev Dependencies", String(count(json.devDependencies))),
            ...(count(json.peerDependencies) === 0 ? [] : [row("Peer Dependencies", String(count(json.peerDependencies)))]),
            ...(count(json.optionalDependencies) === 0 ? [] : [row("Optional Dependencies", String(count(json.optionalDependencies)))]),
          ]),
        ],
        resources: [root.file],
      };
    }),
  );
