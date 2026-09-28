/**
 * The NPM plugin's pages organized into blocks (§23.1).
 *
 * - **The NPM page**, titled for the repo's package manager (PNPM in a pnpm
 *   repo), for the whole workspace, or with `package` for one workspace
 *   package (the same page, scoped to it). Top to bottom: name, version,
 *   description and All Details in one card; Packages (workspace packages,
 *   dependencies, dev dependencies); the pinned scripts, or the best suited
 *   ones until there are pins; and, for the workspace, the package manager's
 *   card. Its 3-dot menu edits the package's details, installs a dependency
 *   or dev dependency, and creates a workspace package.
 * - **Workspace Packages**: every package, each opening its own NPM page.
 * - **A dependency's page** (`package`, `kind`, `name`): what is asked for,
 *   installed and latest, whether an update is available, and updating,
 *   uninstalling and viewing it.
 * - **Details**: everything a package.json says about its package.
 *
 * @internal
 */
import { Effect, FileSystem, Path, Predicate } from "effect";
import { Completed, PluginError, RunTask, type PluginAction, type PluginBlock, type PluginForm, type PluginPageButton, type PluginSectionRow, type PluginSectionsContent } from "../../plugin/api";
import { dependencyActions, installedVersion, installIntoForm, kindByCategory, kindByField, packageAt, type Kind } from "./dependencies";
import { newPackageJson, writeField } from "./packageJson";
import { latestRelease, latestVersion } from "./registry";
import { categorize } from "./scripts";
import { declaredManager, packageManagerFor, packagesIn, valueOf, type Package } from "./workspace";

const row = (label: string, value: string, options: { readonly mono?: boolean; readonly stacked?: boolean } = {}): PluginSectionRow => ({
  label,
  value,
  mono: options.mono === true,
  stacked: options.stacked === true,
});

const optional = (label: string, value: string | undefined, options: { readonly mono?: boolean; readonly stacked?: boolean } = {}): ReadonlyArray<PluginSectionRow> =>
  value === undefined || value.length === 0 ? [] : [row(label, value, options)];

const count = (record: Readonly<Record<string, string>> | undefined) => Object.keys(record ?? {}).length;

const nothing: PluginSectionsContent = {
  blocks: [],
  resources: [],
};

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

const titleOf = (pkg: Package, workspace: string): string => pkg.json.name ?? (pkg.key === "." ? (workspace.split("/").at(-1) ?? pkg.key) : pkg.key);

const failure = (cause: { readonly message: string }) => (cause instanceof PluginError ? cause : new PluginError({ message: cause.message }));

// ── Pinned scripts, and the best ones while nothing is pinned ─────────────────

/** Script names that are usually what a person runs, best first. */
const usual = ["dev", "start", "build", "test", "lint", "typecheck", "check", "format"];

/** Categories that are usually what a person runs, when no name is usual. */
const usualCategories = ["develop", "build", "test", "lint", "typecheck"];

const suggestionRank = (name: string, command: string): number | undefined => {
  const exact = usual.indexOf(name);
  if (exact >= 0) return exact;
  const category = categorize(name, command).find((id) => usualCategories.includes(id));
  return category === undefined ? undefined : usual.length + usualCategories.indexOf(category);
};

/** The best suited scripts of these packages, as Scripts item keys. */
const suggestedScripts = (packages: ReadonlyArray<Package>, size: number): ReadonlyArray<string> =>
  packages
    .flatMap((pkg) =>
      pkg.scripts.flatMap(([name, command]) => {
        const rank = suggestionRank(name, command);
        return rank === undefined
          ? []
          : [
              {
                key: `${pkg.key}#${name}`,
                rank,
              },
            ];
      }),
    )
    .sort((a, b) => a.rank - b.rank)
    .slice(0, size)
    .map((suggestion) => suggestion.key);

// ── Menu forms ────────────────────────────────────────────────────────────────

/** Edit a package's name, version and description, in place in its
 * package.json. An empty version or description removes it. */
const editDetailsForm = (workspace: string, pkg: Package): PluginForm => ({
  command: "npm.editDetails",
  title: "Edit Package Details",
  icon: "codicon:edit",
  fields: [
    {
      id: "name",
      label: "Name",
      kind: "code",
      value: pkg.json.name ?? "",
    },
    {
      id: "version",
      label: "Version",
      kind: "code",
      value: pkg.json.version ?? "",
      placeholder: "0.0.0",
    },
    {
      id: "description",
      label: "Description",
      kind: "text",
      value: pkg.json.description ?? "",
    },
  ],
  submit: (values) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const name = (yield* valueOf(values, "name")).trim();
      const version = (yield* valueOf(values, "version")).trim();
      const description = (yield* valueOf(values, "description")).trim();
      if (name.length === 0) return yield* new PluginError({ message: "a package needs a name" });
      const current = yield* packageAt(workspace, pkg.key);
      const text = yield* fs.readFileString(current.file);
      const named = yield* writeField(text, "name", name, []);
      const versioned = yield* writeField(named, "version", version.length === 0 ? undefined : version, ["name"]);
      const described = yield* writeField(versioned, "description", description.length === 0 ? undefined : description, ["version", "name"]);
      yield* fs.writeFileString(current.file, described);
      return new Completed({ messages: [] });
    }).pipe(Effect.mapError(failure)),
});

/** Whether pnpm-workspace.yaml's package globs take in `folder` (`packages/*`
 * takes in `packages/app`; `packages/**` anything under it). */
const coveredBy = (globs: ReadonlyArray<string>, folder: string): boolean =>
  globs.some((glob) => {
    if (glob === folder) return true;
    if (glob.endsWith("/**")) return folder.startsWith(`${glob.slice(0, -3)}/`);
    if (glob.endsWith("/*")) {
      const parent = glob.slice(0, -2);
      return folder.startsWith(`${parent}/`) && !folder.slice(parent.length + 1).includes("/");
    }
    return false;
  });

/** The package globs of a pnpm-workspace.yaml: its `- glob` lines. */
const workspaceYamlGlobs = (text: string): ReadonlyArray<string> =>
  text.split("\n").flatMap((line) => {
    const glob = /^\s*-\s*['"]?([^'"#\s]+)['"]?\s*(#.*)?$/.exec(line)?.[1];
    return glob === undefined ? [] : [glob];
  });

/** Create a workspace package: its folder and a first package.json. Says if
 * pnpm-workspace.yaml does not take it in yet. */
const createPackageForm = (workspace: string): PluginForm => ({
  command: "npm.createPackage",
  title: "Add Workspace Package",
  icon: "sf:square.stack.3d.up",
  submitTitle: "Add",
  fields: [
    {
      id: "name",
      label: "Name",
      kind: "code",
      placeholder: "@scope/name",
    },
    {
      id: "folder",
      label: "Folder",
      kind: "code",
      placeholder: "packages/name",
    },
  ],
  submit: (values) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const name = (yield* valueOf(values, "name")).trim();
      const folder = (yield* valueOf(values, "folder")).trim().replace(/\/+$/, "");
      if (name.length === 0) return yield* new PluginError({ message: "a package needs a name" });
      if (folder.length === 0 || path.isAbsolute(folder) || folder.split("/").includes("..")) {
        return yield* new PluginError({ message: "the folder is a path inside the workspace, like packages/name" });
      }
      const dir = path.join(workspace, folder);
      if (yield* fs.exists(dir)) return yield* new PluginError({ message: `${folder} already exists` });
      const text = yield* newPackageJson(name);
      yield* fs.makeDirectory(dir, { recursive: true });
      yield* fs.writeFileString(path.join(dir, "package.json"), text);
      const yaml = path.join(workspace, "pnpm-workspace.yaml");
      const globs = (yield* fs.exists(yaml)) ? workspaceYamlGlobs(yield* fs.readFileString(yaml)) : undefined;
      return new Completed({
        messages: [
          `Created ${name} in ${folder}.`,
          ...(globs === undefined || coveredBy(globs, folder) ? [] : [`pnpm-workspace.yaml does not take in ${folder} yet; add it to its packages so pnpm links it.`]),
        ],
      });
    }).pipe(Effect.mapError(failure)),
});

// ── The NPM page ──────────────────────────────────────────────────────────────

/** The self-update each package manager has. */
const selfUpdate = (manager: string): ReadonlyArray<string> =>
  manager === "npm" ? ["install", "--global", "npm@latest"] : manager === "yarn" ? ["set", "version", "latest"] : manager === "bun" ? ["upgrade"] : ["self-update"];

/** Dependencies of one kind across these packages, each name once. */
const uniqueOf = (packages: ReadonlyArray<Package>, kind: Kind) => new Set(packages.flatMap((pkg) => Object.keys(pkg.json[kind.field] ?? {}))).size;

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
    const dependencies = kindByField("dependencies");
    const dev = kindByField("devDependencies");
    const block: PluginBlock = {
      _tag: "Card",
      key: "manager",
      title: manager,
      icon: "sf:shippingbox",
      rows: [
        row("Version", declared?.version ?? "Not pinned", { mono: declared?.version !== undefined }),
        "version" in latest ? row("Latest", latest.version, { mono: true }) : row("Latest", `Couldn’t check: ${latest.error}`),
        ...(dependencies === undefined ? [] : [row("Dependencies", String(uniqueOf(packages, dependencies)))]),
        ...(dev === undefined ? [] : [row("Dev Dependencies", String(uniqueOf(packages, dev)))]),
        ...(packages.length > 1 ? [row("Workspace Packages", String(packages.length))] : []),
      ],
      opens: { page: "packages" },
      actions: update,
    };
    return {
      manager,
      block,
    };
  });

/** The Packages section: the workspace's packages (for the whole
 * workspace), and the dependencies and dev dependencies, each opening its
 * list. `pkg` scopes it to one package. */
const packagesBlock = (packages: ReadonlyArray<Package>, pkg: Package | undefined): PluginBlock => {
  const scope = pkg === undefined ? packages : [pkg];
  const group: Readonly<Record<string, string>> = pkg === undefined ? {} : { group: pkg.key };
  const listOf = (field: string, title: string): ReadonlyArray<PluginPageButton> => {
    const kind = kindByField(field);
    return kind === undefined
      ? []
      : [
          {
            page: "packages",
            params: {
              ...group,
              category: kind.category,
            },
            title,
            icon: kind.icon,
            detail: String(uniqueOf(scope, kind)),
          },
        ];
  };
  const members = packages.filter((candidate) => candidate.key !== ".");
  return {
    _tag: "Facts",
    title: "Packages",
    rows: [],
    links: [
      ...(pkg === undefined && members.length > 0
        ? [
            {
              page: "workspace",
              title: "Workspace Packages",
              icon: "sf:square.stack.3d.up",
              detail: String(members.length),
            },
          ]
        : []),
      ...listOf("dependencies", "Dependencies"),
      ...listOf("devDependencies", "Development Dependencies"),
    ],
  };
};

/** The package: its name, version, folder and description, the whole card
 * opening all its details. */
const aboutBlock = (pkg: Package, workspace: string): PluginBlock => ({
  _tag: "Facts",
  rows: [
    row("Name", titleOf(pkg, workspace)),
    ...optional("Version", pkg.json.version, { mono: true }),
    ...(pkg.key === "." ? [] : [row("Folder", pkg.key, { mono: true })]),
    ...optional("Description", pkg.json.description, { stacked: true }),
  ],
  opens: {
    page: "details",
    params: { package: pkg.key },
  },
});

const pinnedBlock = (pkg: Package | undefined, suggestions: ReadonlyArray<string>): PluginBlock => ({
  _tag: "Pinned",
  collection: pkg === undefined ? { page: "scripts" } : { page: "scripts", params: { group: pkg.key } },
  title: "Pinned Scripts",
  viewAll: "View All Scripts",
  empty: "Pin a script from its menu to keep it here.",
  ...(pkg === undefined ? {} : { group: pkg.key }),
  suggestions,
  suggestionsNote: "Suggested until you pin scripts",
});

const installForms = (workspace: string, key: string): ReadonlyArray<PluginForm> => {
  const dependencies = kindByField("dependencies");
  const dev = kindByField("devDependencies");
  return [
    ...(dependencies === undefined ? [] : [installIntoForm(workspace, key, dependencies, "npm.installDependency", "Add Dependency")]),
    ...(dev === undefined ? [] : [installIntoForm(workspace, key, dev, "npm.installDevDependency", "Add Dev Dependency")]),
  ];
};

export const npmPage = (workspace: string, params: Readonly<Record<string, string>>) =>
  Effect.gen(function* () {
    const packages = yield* packagesIn(workspace);
    const root = packages.find((candidate) => candidate.key === ".");
    const requested = params["package"];
    if (requested !== undefined && requested !== ".") {
      const pkg = packages.find((candidate) => candidate.key === requested);
      if (pkg === undefined) return yield* new PluginError({ message: `there is no package at ${requested}` });
      const content: PluginSectionsContent = {
        title: titleOf(pkg, workspace),
        blocks: [aboutBlock(pkg, workspace), packagesBlock(packages, pkg), pinnedBlock(pkg, suggestedScripts([pkg], 4))],
        menu: [editDetailsForm(workspace, pkg)],
        add: installForms(workspace, pkg.key),
        resources: [pkg.file],
      };
      return content;
    }
    if (root === undefined && packages.length === 0) return nothing;
    const card = yield* managerCard(workspace, packages, root);
    // The root's scripts are the ones a person runs; a workspace with no root
    // scripts offers its packages' instead.
    const suggestions = suggestedScripts(root === undefined || root.scripts.length === 0 ? packages : [root], 4);
    const content: PluginSectionsContent = {
      // The page is named for the repo's own package manager.
      title: card.manager.toUpperCase(),
      blocks: [...(root === undefined ? [] : [aboutBlock(root, workspace)]), packagesBlock(packages, undefined), pinnedBlock(undefined, suggestions), card.block],
      menu: root === undefined ? [] : [editDetailsForm(workspace, root)],
      add: [...(root === undefined ? [] : installForms(workspace, root.key)), createPackageForm(workspace)],
      resources: packages.map((pkg) => pkg.file),
    };
    return content;
  });

/** Every workspace package, each opening its own NPM page. */
export const workspacePage = (workspace: string) =>
  packagesIn(workspace).pipe(
    Effect.map((packages): PluginSectionsContent => {
      const members = packages.filter((pkg) => pkg.key !== ".");
      if (members.length === 0) return nothing;
      return {
        blocks: [
          {
            _tag: "Facts",
            rows: [],
            links: members.map((pkg) => ({
              page: "npm",
              params: { package: pkg.key },
              title: titleOf(pkg, workspace),
              icon: "sf:shippingbox",
              detail: pkg.json.version ?? pkg.key,
            })),
          },
        ],
        add: [createPackageForm(workspace)],
        resources: packages.map((pkg) => pkg.file),
      };
    }),
  );

const actionsBlock = (actions: ReadonlyArray<PluginAction>): PluginBlock => ({
  _tag: "Actions",
  key: "dependency",
  actions,
});

/** One dependency of one package: asked for, installed, latest, and what can
 * be done with it. */
export const dependencyPage = (workspace: string, params: Readonly<Record<string, string>>) =>
  Effect.gen(function* () {
    const key = params["package"];
    const field = params["kind"];
    const name = params["name"];
    if (key === undefined || field === undefined || name === undefined) return yield* new PluginError({ message: "a dependency's page needs its package, kind and name" });
    const kind = kindByField(field) ?? kindByCategory(field);
    if (kind === undefined) return yield* new PluginError({ message: `${field} is not a kind of dependency` });
    const pkg = yield* packageAt(workspace, key);
    const range = pkg.json[kind.field]?.[name];
    const installed = yield* installedVersion(pkg, name);
    const release = yield* latestRelease(name).pipe(
      Effect.map((found) => ({ found })),
      Effect.catch((error) => Effect.succeed({ error: error.message })),
    );
    const latest = "found" in release ? release.found.version : undefined;
    const updateAvailable = latest !== undefined && installed !== undefined && latest !== installed;
    const status =
      range === undefined
        ? `No longer in ${titleOf(pkg, workspace)}’s ${kind.name.toLowerCase()}`
        : installed === undefined
          ? "Not installed"
          : latest === undefined
            ? "Couldn’t check for updates"
            : updateAvailable
              ? "Update available"
              : "Up to date";
    const content: PluginSectionsContent = {
      title: name,
      blocks: [
        {
          _tag: "Facts",
          rows: [
            row("Status", status),
            ...optional("Asked For", range, { mono: true }),
            row("Installed", installed ?? "Not installed", { mono: installed !== undefined }),
            "found" in release ? row("Latest", release.found.version, { mono: true }) : row("Latest", `Couldn’t check: ${release.error}`),
            ...("found" in release
              ? [
                  ...optional("Description", release.found.description, { stacked: true }),
                  ...optional("License", release.found.license),
                  ...optional("Homepage", release.found.homepage, { stacked: true }),
                ]
              : []),
          ],
        },
        {
          _tag: "Facts",
          title: "In",
          rows: [row("Package", titleOf(pkg, workspace)), row("As", kind.name)],
        },
        ...(range === undefined ? [] : [actionsBlock(dependencyActions(pkg, kind, name, updateAvailable ? latest : undefined))]),
      ],
      resources: [pkg.file],
    };
    return content;
  });

/** Everything a package.json says about its package (`package`, the root by
 * default). */
export const detailsPage = (workspace: string, params: Readonly<Record<string, string>>) =>
  packagesIn(workspace).pipe(
    Effect.map((packages): PluginSectionsContent => {
      const pkg = packages.find((candidate) => candidate.key === (params["package"] ?? "."));
      if (pkg === undefined) return nothing;
      const { json } = pkg;
      const facts = (title: string, rows: ReadonlyArray<PluginSectionRow>): ReadonlyArray<PluginBlock> =>
        rows.length === 0
          ? []
          : [
              {
                _tag: "Facts",
                title,
                rows,
              },
            ];
      return {
        title: pkg.key === "." ? "Details" : `${titleOf(pkg, workspace)} Details`,
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
            row("Scripts", String(pkg.scripts.length)),
            row("Dependencies", String(count(json.dependencies))),
            row("Dev Dependencies", String(count(json.devDependencies))),
            ...(count(json.peerDependencies) === 0 ? [] : [row("Peer Dependencies", String(count(json.peerDependencies)))]),
            ...(count(json.optionalDependencies) === 0 ? [] : [row("Optional Dependencies", String(count(json.optionalDependencies)))]),
          ]),
        ],
        resources: [pkg.file],
      };
    }),
  );
