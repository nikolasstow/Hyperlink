/**
 * The extension host proper: runs inside a host worker, one per workspace.
 *
 * It activates each configured extension against the `vscode` shim, then
 * answers the protocol: which views exist, a view's rows, and what a row's
 * action does. Extension objects stay in here; the caller gets data and ids.
 *
 * A row may only be asked to run a command its own manifest attaches to that
 * kind of row (or the row's own open command). Anything else is refused, so the
 * API cannot be used to call arbitrary extension commands.
 *
 * @internal
 */
import { Duration, Effect, FileSystem, ManagedRuntime, Option, Path, Predicate, Ref, Result, Schema } from "effect";
import { NodeServices } from "@effect/platform-node";
import { importedNames, installVscodeModule } from "./loader";
import { Completed, ExtensionHostError, OpenFile, RunTask, TreeEntry, ViewAction, ViewInfo, ViewNode, ViewRequestError, type InvokeResult, type TreeRefresh } from "./protocol";
import { EventEmitter, ProcessExecution, ShellExecution, Task, Uri, makeRegistry, makeVscode, toWorkspaceFolder, type Registry, type WorkspaceFolderInfo } from "./shim";
import { matchesWhen } from "./when";

// ── Manifest ───────────────────────────────────────────────────────────────────

const commandIcon = Schema.Union([Schema.String, Schema.Struct({ light: Schema.String, dark: Schema.String })]);

const manifestSchema = Schema.Struct({
  name: Schema.String,
  publisher: Schema.String,
  main: Schema.optionalKey(Schema.String),
  contributes: Schema.optionalKey(
    Schema.Struct({
      views: Schema.optionalKey(
        Schema.Record(
          Schema.String,
          Schema.Array(
            Schema.Struct({
              id: Schema.String,
              name: Schema.optionalKey(Schema.String),
            }),
          ),
        ),
      ),
      commands: Schema.optionalKey(
        Schema.Array(
          Schema.Struct({
            command: Schema.String,
            title: Schema.String,
            icon: Schema.optionalKey(commandIcon),
          }),
        ),
      ),
      menus: Schema.optionalKey(
        Schema.Record(
          Schema.String,
          Schema.Array(
            Schema.Struct({
              command: Schema.optionalKey(Schema.String),
              when: Schema.optionalKey(Schema.String),
              group: Schema.optionalKey(Schema.String),
            }),
          ),
        ),
      ),
      configuration: Schema.optionalKey(Schema.Unknown),
    }),
  ),
});

type Manifest = typeof manifestSchema.Type;

interface Loaded {
  readonly id: string;
  readonly dir: string;
  readonly manifest: Manifest;
  readonly localize: (text: string) => string;
}

const failure = (reason: ExtensionHostError["reason"], message: string) =>
  new ExtensionHostError({
    reason,
    message,
  });

const rejected = (reason: ViewRequestError["reason"], message: string) =>
  new ViewRequestError({
    reason,
    message,
  });

const loadManifest = (dir: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const manifest = yield* fs
      .readFileString(path.join(dir, "package.json"))
      .pipe(Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(manifestSchema))));
    const nlsFile = path.join(dir, "package.nls.json");
    const hasNls = yield* fs.exists(nlsFile);
    const nls = hasNls
      ? yield* fs.readFileString(nlsFile).pipe(Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Record(Schema.String, Schema.String)))))
      : {};
    const table = new Map(Object.entries(nls));
    const loaded: Loaded = {
      id: `${manifest.publisher}.${manifest.name}`,
      dir,
      manifest,
      localize: (text) => text.replace(/^%(.+)%$/, (match, key: string) => table.get(key) ?? match),
    };
    return loaded;
  }).pipe(Effect.mapError((cause) => failure("ActivationFailed", `${dir}: unreadable manifest (${String(cause)})`)));

/** Setting defaults from every loaded manifest, for `getConfiguration`. */
const settingDefaults = (extensions: ReadonlyArray<Loaded>): ReadonlyMap<string, unknown> =>
  new Map(
    extensions.flatMap((extension) => {
      const configuration = extension.manifest.contributes?.configuration;
      const blocks = Array.isArray(configuration) ? configuration : [configuration];
      return blocks.flatMap((block) => {
        const properties = Predicate.hasProperty(block, "properties") && Predicate.isObject(block.properties) ? block.properties : {};
        return Object.entries(properties).flatMap(([key, property]): ReadonlyArray<readonly [string, unknown]> =>
          Predicate.hasProperty(property, "default") ? [[key, property.default]] : [],
        );
      });
    }),
  );

// ── Activation ─────────────────────────────────────────────────────────────────

const memento = () => {
  const values = new Map<string, unknown>();
  return {
    get: (key: string, fallback?: unknown) => (values.has(key) ? values.get(key) : fallback),
    update: (key: string, value: unknown) => {
      values.set(key, value);
      return Promise.resolve();
    },
    keys: () => [...values.keys()],
    setKeysForSync: () => undefined,
  };
};

const activate = (extension: Loaded, registry: Registry) =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const main = extension.manifest.main;
    if (main === undefined) return;
    const url = yield* path.toFileUrl(path.join(extension.dir, main.endsWith(".js") ? main : `${main}.js`));
    const failed = (cause: unknown) =>
      failure(
        "ActivationFailed",
        `${extension.id}: ${cause instanceof Error ? cause.message : String(cause)}. Unimplemented API touched: ${[...registry.missing].sort().join(", ") || "none"}`,
      );
    const module = yield* Effect.tryPromise({
      try: () => import(url.href),
      catch: failed,
    });
    const entry: unknown = Predicate.hasProperty(module, "activate")
      ? module.activate
      : Predicate.hasProperty(module, "default") && Predicate.hasProperty(module.default, "activate")
        ? module.default.activate
        : undefined;
    if (!Predicate.isFunction(entry)) return yield* failure("ActivationFailed", `${extension.id} exports no activate()`);
    const context = {
      subscriptions: [],
      extensionPath: extension.dir,
      extensionUri: Uri.file(extension.dir),
      globalState: memento(),
      workspaceState: memento(),
      asAbsolutePath: (relative: string) => path.join(extension.dir, relative),
      extensionMode: 1,
      extension: {
        id: extension.id,
        packageJSON: extension.manifest,
      },
    };
    yield* Effect.tryPromise({
      try: () => Promise.resolve(entry(context)),
      catch: failed,
    });
  });

// ── Rows ───────────────────────────────────────────────────────────────────────

interface TreeProvider {
  readonly getChildren: (element?: unknown) => unknown;
  readonly getTreeItem: (element: unknown) => unknown;
}

const isTreeProvider = (value: unknown): value is TreeProvider =>
  Predicate.hasProperty(value, "getChildren") &&
  Predicate.isFunction(value.getChildren) &&
  Predicate.hasProperty(value, "getTreeItem") &&
  Predicate.isFunction(value.getTreeItem);

const treeItemSchema = Schema.Struct({
  label: Schema.optionalKey(Schema.Union([Schema.String, Schema.Struct({ label: Schema.String })])),
  description: Schema.optionalKey(Schema.Union([Schema.String, Schema.Boolean])),
  tooltip: Schema.optionalKey(Schema.Union([Schema.String, Schema.Struct({ value: Schema.String })])),
  contextValue: Schema.optionalKey(Schema.String),
  collapsibleState: Schema.optionalKey(Schema.Number),
  iconPath: Schema.optionalKey(Schema.Unknown),
  resourceUri: Schema.optionalKey(Schema.Unknown),
  command: Schema.optionalKey(
    Schema.Struct({
      command: Schema.String,
      title: Schema.optionalKey(Schema.String),
      arguments: Schema.optionalKey(Schema.Array(Schema.Unknown)),
    }),
  ),
});

/** A row the host has handed out: the live element and what its actions are. */
interface Row {
  readonly view: string;
  readonly element: unknown;
  readonly actions: ReadonlyArray<ViewAction>;
  readonly open: Option.Option<{
    readonly command: string;
    readonly args: ReadonlyArray<unknown>;
  }>;
}

const call = (what: string, run: () => unknown) =>
  Effect.tryPromise({
    try: () => Promise.resolve(run()),
    catch: (cause) => failure("ProviderFailed", `${what}: ${cause instanceof Error ? cause.message : String(cause)}`),
  });

const iconName = (icon: unknown): string | undefined => {
  if (Predicate.isString(icon)) {
    const codicon = /^\$\(([\w-]+)\)$/.exec(icon);
    return codicon === null ? icon : `codicon:${codicon[1] ?? ""}`;
  }
  if (icon instanceof Uri) return icon.fsPath;
  if (Predicate.hasProperty(icon, "id") && Predicate.isString(icon.id)) return `codicon:${icon.id}`;
  if (Predicate.hasProperty(icon, "dark")) return iconName(icon.dark);
  return undefined;
};

const text = (value: string | { readonly label: string } | { readonly value: string } | undefined): string | undefined =>
  value === undefined ? undefined : Predicate.isString(value) ? value : "label" in value ? value.label : value.value;

/** How long after a command resolves its fire-and-forget effects are still
 * attributed to it, and how often that window is checked. A command whose
 * effect has already landed returns at once; only one that has produced
 * nothing yet waits, and only until something lands. */
const settleWindow = Duration.millis(250);
const settleStep = Duration.millis(10);

/** How deep a whole-tree walk goes, and how many rows it returns at most. */
const maxTreeDepth = 6;
const maxTreeRows = 5000;

// ── The host ───────────────────────────────────────────────────────────────────

export interface HostOptions {
  readonly extensions: ReadonlyArray<string>;
}

/** A row the host produced, with the live element it came from. */
interface Produced {
  readonly element: unknown;
  readonly node: ViewNode;
}

/**
 * Activate the extensions and return the protocol's handlers.
 *
 * One host serves every workspace as a folder of one multi-root window, the
 * way VS Code runs one extension host per window: a host is a runtime and an
 * extension's state, and one per repo would cost that many times over.
 * Folders join as requests name them, firing `onDidChangeWorkspaceFolders` so
 * extensions pick them up.
 */
export const makeHost = (options: HostOptions) =>
  Effect.gen(function* () {
    const loaded = yield* Effect.forEach(options.extensions, loadManifest);
    const registry = makeRegistry();
    const shimRuntime = ManagedRuntime.make(NodeServices.layer);
    yield* Effect.addFinalizer(() => shimRuntime.disposeEffect);
    const folders = yield* Ref.make<ReadonlyArray<WorkspaceFolderInfo>>([]);
    const foldersChanged = new EventEmitter<{
      readonly added: ReadonlyArray<unknown>;
      readonly removed: ReadonlyArray<unknown>;
    }>();
    const vscode = makeVscode({
      // VS Code's `workspaceFolders` is a synchronous read, so the shim reads
      // the Ref unsafely here; every write goes through `addFolders`.
      folders: () => Ref.getUnsafe(folders),
      foldersChanged,
      defaults: settingDefaults(loaded),
      runtime: shimRuntime,
      registry,
    });

    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const sources = yield* Effect.forEach(loaded, (extension) =>
      extension.manifest.main === undefined
        ? Effect.succeed("")
        : fs.readFileString(path.join(extension.dir, extension.manifest.main.endsWith(".js") ? extension.manifest.main : `${extension.manifest.main}.js`)),
    ).pipe(Effect.mapError((cause) => failure("ActivationFailed", String(cause))));
    yield* installVscodeModule(
      vscode,
      sources.flatMap((source) => importedNames(source)),
    ).pipe(Effect.mapError((cause) => failure("ActivationFailed", cause.message)));
    yield* Effect.forEach(loaded, (extension) => activate(extension, registry), { discard: true });

    /** Every view declared by a loaded manifest, with its owner. */
    const declared = loaded.flatMap((extension) =>
      Object.values(extension.manifest.contributes?.views ?? {})
        .flat()
        .map((view) => ({
          view,
          extension,
        })),
    );
    const ownerOf = (view: string) =>
      Option.match(Option.fromUndefinedOr(declared.find((entry) => entry.view.id === view)), {
        onNone: () => Effect.fail(rejected("UnknownView", `no manifest declares ${view}`)),
        onSome: Effect.succeed,
      });

    // ── Folders ──

    /** Add workspaces as folders. A folder's name is its directory's name, or
     * that with its parent's on a clash, since extensions key trees by name. */
    const addFolders = (paths: ReadonlyArray<string>) =>
      Ref.modify(folders, (current): readonly [ReadonlyArray<WorkspaceFolderInfo>, ReadonlyArray<WorkspaceFolderInfo>] => {
        const added = [...new Set(paths)]
          .filter((candidate) => !current.some((folder) => folder.path === candidate))
          .reduce<ReadonlyArray<WorkspaceFolderInfo>>((acc, candidate) => {
            const taken = (name: string) => [...current, ...acc].some((folder) => folder.name === name);
            const base = path.basename(candidate);
            const withParent = `${base} (${path.basename(path.dirname(candidate))})`;
            const name = !taken(base) ? base : !taken(withParent) ? withParent : candidate;
            return [...acc, { path: candidate, name }];
          }, []);
        return [added, [...current, ...added]];
      }).pipe(
        Effect.tap((added) =>
          added.length === 0
            ? Effect.void
            : Ref.get(folders).pipe(
                Effect.flatMap((all) =>
                  Effect.sync(() =>
                    foldersChanged.fire({
                      added: added.map((folder) => toWorkspaceFolder(folder, all.findIndex((entry) => entry.path === folder.path))),
                      removed: [],
                    }),
                  ),
                ),
              ),
        ),
      );

    // ── Rows ──

    /** Rows handed out so far, by id, and the id counter. */
    const state = yield* Ref.make<{
      readonly nextId: number;
      readonly rows: ReadonlyMap<string, Row>;
    }>({
      nextId: 0,
      rows: new Map(),
    });
    /** Element identity → id, so a row keeps its id while the extension keeps
     * returning the same object. Keyed by the extension's live objects, which
     * only a WeakMap can do without holding them alive. */
    const ids = new WeakMap<object, string>();
    const remember = (view: string, element: unknown, row: Row) =>
      Ref.modify(state, (current) => {
        const known = Predicate.isObject(element) ? ids.get(element) : undefined;
        const nextId = known === undefined ? current.nextId + 1 : current.nextId;
        const id = known ?? `${view}:${nextId}`;
        if (known === undefined && Predicate.isObject(element)) ids.set(element, id);
        return [id, { nextId, rows: new Map([...current.rows, [id, row]]) }];
      });
    const rowById = (id: string) => Ref.get(state).pipe(Effect.map((current) => Option.fromUndefinedOr(current.rows.get(id))));

    /** The actions a manifest attaches to one row, from its
     * `view/item/context` menu entries whose `when` holds for the row. */
    const actionsFor = (extension: Loaded, view: string, contextValue: string | undefined): ReadonlyArray<ViewAction> => {
      const context = new Map<string, unknown>([...registry.contextKeys, ["view", view], ["viewItem", contextValue ?? ""]]);
      const commands = extension.manifest.contributes?.commands ?? [];
      return (extension.manifest.contributes?.menus?.["view/item/context"] ?? []).flatMap((entry) => {
        const holds = Result.getOrElse(matchesWhen(entry.when, context), () => false);
        const command = entry.command;
        if (!holds || command === undefined) return [];
        const declaredCommand = commands.find((candidate) => candidate.command === command);
        const icon = iconName(declaredCommand?.icon);
        return [
          new ViewAction({
            command,
            title: extension.localize(declaredCommand?.title ?? command),
            ...(icon === undefined ? {} : { icon }),
            inline: (entry.group ?? "").startsWith("inline"),
          }),
        ];
      });
    };

    const provider = (view: string) => {
      const found = registry.treeViews.get(view);
      return isTreeProvider(found) ? Effect.succeed(found) : Effect.fail(rejected("UnknownView", `no tree view ${view}`));
    };

    /** The rows under `parent` (the top level when undefined), as data. */
    const produce = (view: string, parent: unknown) =>
      Effect.gen(function* () {
        const tree = yield* provider(view);
        const owner = yield* ownerOf(view);
        const raw = yield* call("getChildren", () => tree.getChildren(parent));
        const elements = Array.isArray(raw) ? raw : [];
        return yield* Effect.forEach(elements, (element) =>
          Effect.gen(function* () {
            const itemRaw = yield* call("getTreeItem", () => tree.getTreeItem(element));
            const item = yield* Schema.decodeUnknownEffect(treeItemSchema)(itemRaw).pipe(
              Effect.mapError((cause) => failure("ProviderFailed", `a tree item did not decode: ${cause.message}`)),
            );
            const actions = actionsFor(owner.extension, view, item.contextValue);
            const openCommand = item.command;
            const id = yield* remember(view, element, {
              view,
              element,
              actions,
              open:
                openCommand === undefined
                  ? Option.none()
                  : Option.some({
                      command: openCommand.command,
                      args: openCommand.arguments ?? [],
                    }),
            });
            const resourcePath = item.resourceUri instanceof Uri ? item.resourceUri.fsPath : undefined;
            const description = Predicate.isString(item.description) ? item.description : undefined;
            const tooltip = text(item.tooltip);
            const icon = iconName(item.iconPath);
            const produced: Produced = {
              element,
              node: new ViewNode({
                id,
                label: text(item.label) ?? resourcePath?.split("/").at(-1) ?? "",
                ...(description === undefined ? {} : { description }),
                ...(tooltip === undefined ? {} : { tooltip }),
                ...(icon === undefined ? {} : { icon }),
                ...(item.contextValue === undefined ? {} : { contextValue: item.contextValue }),
                ...(resourcePath === undefined ? {} : { resource: resourcePath }),
                collapsible: (item.collapsibleState ?? 0) > 0,
                expanded: item.collapsibleState === 2,
                ...(openCommand === undefined
                  ? {}
                  : {
                      open: new ViewAction({
                        command: openCommand.command,
                        title: openCommand.title ?? "Open",
                        inline: false,
                      }),
                    }),
                actions,
              }),
            };
            return produced;
          }),
        );
      });

    /**
     * One workspace's top rows. A multi-root view puts a row per folder at the
     * top whose resource is the folder (npm does); that row's children are the
     * workspace's rows. With a single folder there is no folder row, and the
     * top rows inside the workspace are its own.
     */
    const workspaceRoots = (view: string, workspace: string) =>
      Effect.gen(function* () {
        const top = yield* produce(view, undefined);
        const own = top.find((entry) => entry.node.resource === workspace);
        if (own !== undefined) return yield* produce(view, own.element);
        const all = yield* Ref.get(folders);
        return top.filter((entry) =>
          entry.node.resource === undefined ? all.length === 1 : entry.node.resource.startsWith(`${workspace}/`),
        );
      });

    /** Depth-first, flat, each row with its parent's id. */
    const flatten = (view: string, entries: ReadonlyArray<Produced>, parent: string | undefined, depth: number): Effect.Effect<ReadonlyArray<TreeEntry>, ExtensionHostError | ViewRequestError> =>
      Effect.forEach(entries, (entry) => {
        const row = new TreeEntry({
          ...(parent === undefined ? {} : { parent }),
          node: entry.node,
        });
        return entry.node.collapsible && depth < maxTreeDepth
          ? produce(view, entry.element).pipe(
              Effect.flatMap((children) => flatten(view, children, entry.node.id, depth + 1)),
              Effect.map((below) => [row, ...below]),
            )
          : Effect.succeed([row]);
      }).pipe(Effect.map((nested) => nested.flat().slice(0, maxTreeRows)));

    /** Run a view's own refresh: the `view/title` command its manifest shows
     * for this view with a refresh icon or a `.refresh` id. */
    const refreshView = (view: string) =>
      Effect.gen(function* () {
        const owner = yield* ownerOf(view);
        const context = new Map<string, unknown>([...registry.contextKeys, ["view", view]]);
        const commands = owner.extension.manifest.contributes?.commands ?? [];
        const refreshers = (owner.extension.manifest.contributes?.menus?.["view/title"] ?? []).flatMap((entry) => {
          const command = entry.command;
          if (command === undefined || !Result.getOrElse(matchesWhen(entry.when, context), () => false)) return [];
          const icon = iconName(commands.find((candidate) => candidate.command === command)?.icon);
          return icon === "codicon:refresh" || command.endsWith(".refresh") ? [command] : [];
        });
        yield* Effect.forEach(refreshers, (command) => call(command, () => vscode.commands.executeCommand(command)), { discard: true });
      });

    const viewIds = () => declared.map((entry) => entry.view.id).filter((id) => isTreeProvider(registry.treeViews.get(id)));

    // ── Handlers ──

    /** The views with something to show for this workspace (npm's, only
     * where there is a package.json). */
    const Views = (payload: { readonly workspace: string }) =>
      addFolders([payload.workspace]).pipe(
        Effect.andThen(
          Effect.forEach(viewIds(), (view) =>
            workspaceRoots(view, payload.workspace).pipe(
              Effect.map((roots): ReadonlyArray<ViewInfo> => {
                const entry = declared.find((candidate) => candidate.view.id === view);
                return roots.length === 0 || entry === undefined
                  ? []
                  : [
                      new ViewInfo({
                        id: view,
                        name: entry.extension.localize(entry.view.name ?? view),
                        extension: entry.extension.id,
                      }),
                    ];
              }),
            ),
          ),
        ),
        Effect.map((found) => found.flat()),
      );

    const Children = (payload: { readonly workspace: string; readonly view: string; readonly parent?: string }) =>
      Effect.gen(function* () {
        yield* addFolders([payload.workspace]);
        if (payload.parent === undefined) {
          const roots = yield* workspaceRoots(payload.view, payload.workspace);
          return roots.map((entry) => entry.node);
        }
        const parent = yield* rowById(payload.parent);
        if (Option.isNone(parent)) return yield* rejected("UnknownNode", `unknown row ${payload.parent}`);
        const children = yield* produce(payload.view, parent.value.element);
        return children.map((entry) => entry.node);
      });

    /** Modification times of the files behind each tree last returned, by
     * `view workspace`: what `ifChanged` compares against. */
    const seen = yield* Ref.make<ReadonlyMap<string, ReadonlyMap<string, number>>>(new Map());

    /** The files behind a tree's rows, with their modification times. Rows
     * whose resource is a directory or is gone are left out. */
    const fingerprint = (rows: ReadonlyArray<TreeEntry>) =>
      Effect.forEach(
        [...new Set(rows.flatMap((row) => (row.node.resource === undefined ? [] : [row.node.resource])))],
        (resource) =>
          fs.stat(resource).pipe(
            Effect.map((info): ReadonlyArray<readonly [string, number]> =>
              info.type === "File" ? [[resource, Option.match(info.mtime, { onNone: () => 0, onSome: (date) => date.getTime() })]] : [],
            ),
            Effect.orElseSucceed((): ReadonlyArray<readonly [string, number]> => []),
          ),
      ).pipe(Effect.map((pairs) => new Map(pairs.flat())));

    /** Whether any file behind the last tree for this key changed or vanished. */
    const changedSince = (key: string) =>
      Ref.get(seen).pipe(
        Effect.flatMap((all) => {
          const previous = all.get(key);
          if (previous === undefined) return Effect.succeed(true);
          return Effect.forEach([...previous], ([file, mtime]) =>
            fs.stat(file).pipe(
              Effect.map((info) => Option.match(info.mtime, { onNone: () => 0, onSome: (date) => date.getTime() }) !== mtime),
              Effect.orElseSucceed(() => true),
            ),
          ).pipe(Effect.map((changes) => changes.some(Boolean)));
        }),
      );

    const Tree = (payload: { readonly workspace: string; readonly view: string; readonly refresh: TreeRefresh }) =>
      Effect.gen(function* () {
        yield* addFolders([payload.workspace]);
        const key = `${payload.view} ${payload.workspace}`;
        const stale =
          payload.refresh === "force" ? true : payload.refresh === "ifChanged" ? yield* changedSince(key) : false;
        if (stale && payload.refresh !== "none") yield* refreshView(payload.view);
        const roots = yield* workspaceRoots(payload.view, payload.workspace);
        const rows = yield* flatten(payload.view, roots, undefined, 0);
        const files = yield* fingerprint(rows);
        yield* Ref.update(seen, (all) => new Map([...all, [key, files]]));
        return rows;
      });

    /** Join these workspaces and walk their trees now, so the extension's own
     * caches (npm's script search) are hot before anyone asks. */
    const Warm = (payload: { readonly workspaces: ReadonlyArray<string> }) =>
      addFolders(payload.workspaces).pipe(
        Effect.andThen(
          Effect.forEach(
            payload.workspaces,
            (workspace) => Effect.forEach(viewIds(), (view) => Tree({ workspace, view, refresh: "none" }), { discard: true }),
            { discard: true },
          ),
        ),
      );

    const Invoke = (payload: { readonly workspace: string; readonly view: string; readonly node: string; readonly command: string }) =>
      Effect.gen(function* () {
        const found = yield* rowById(payload.node);
        if (Option.isNone(found) || found.value.view !== payload.view) return yield* rejected("UnknownNode", `unknown row ${payload.node}`);
        const row = found.value;
        const opening = Option.filter(row.open, (open) => open.command === payload.command);
        const offered = Option.isSome(opening) || row.actions.some((action) => action.command === payload.command);
        if (!offered) return yield* rejected("UnknownCommand", `${payload.command} is not offered on this row`);

        const tasksBefore = registry.executedTasks.length;
        const opensBefore = registry.opened.length;
        const messagesBefore = registry.messages.length;
        const missingBefore = new Set(registry.missing);
        const args = Option.match(opening, {
          onNone: () => [row.element],
          onSome: (open) => open.args,
        });
        yield* call(payload.command, () => vscode.commands.executeCommand(payload.command, ...args));
        // Commands often fire and forget (npm's debug starts an async lookup,
        // then calls another command without awaiting it). Return as soon as
        // an effect has landed; wait out the window only while none has.
        const landed = () => registry.executedTasks.length > tasksBefore || registry.opened.length > opensBefore;
        const settle = (remaining: number): Effect.Effect<void> =>
          landed() || remaining <= 0 ? Effect.void : Effect.sleep(settleStep).pipe(Effect.andThen(settle(remaining - 1)));
        yield* settle(Math.ceil(Duration.toMillis(settleWindow) / Duration.toMillis(settleStep)));

        const task = registry.executedTasks.slice(tasksBefore).at(-1);
        if (task instanceof Task) return yield* toRunTask(task, payload.workspace);
        const opened = registry.opened.slice(opensBefore).at(-1);
        if (opened !== undefined) {
          const result: InvokeResult = new OpenFile({
            path: opened.path,
            ...(opened.line === undefined ? {} : { line: opened.line }),
          });
          return result;
        }
        // The command reached for API the host does not implement (a debugger,
        // a terminal) and produced nothing we act on: say so, instead of
        // reporting a success that did nothing.
        const unimplemented = [...registry.missing].filter((name) => !missingBefore.has(name));
        if (unimplemented.length > 0) {
          return yield* failure("Unsupported", `${payload.command} needs editor features this host does not have: ${unimplemented.join(", ")}`);
        }
        const result: InvokeResult = new Completed({
          messages: registry.messages.slice(messagesBefore).map((message) => String(message.text)),
        });
        return result;
      });

    return {
      Views,
      Children,
      Tree,
      Invoke,
      Warm,
    };
  });

/** A task as argv for the process runner. A shell command line is split only
 * when it has no shell syntax in it; anything else is refused rather than run
 * through a shell here. */
const toRunTask = (task: Task, workspace: string): Effect.Effect<InvokeResult, ExtensionHostError> => {
  const execution = task.execution;
  const cwdOption = Predicate.hasProperty(execution?.options, "cwd") ? execution?.options.cwd : undefined;
  const cwd = Predicate.isString(cwdOption) ? cwdOption : workspace;
  const part = (value: unknown) => (Predicate.hasProperty(value, "value") ? String(value.value) : String(value));
  const argv =
    execution instanceof ShellExecution
      ? execution.commandLine === undefined
        ? Option.some([part(execution.command), ...(execution.args ?? []).map(part)])
        : /[|&;<>()$`\\"'*?{}[\]~]/.test(execution.commandLine)
          ? Option.none()
          : Option.some(execution.commandLine.trim().split(/\s+/))
      : execution instanceof ProcessExecution
        ? Option.some([execution.process, ...(execution.args ?? [])])
        : Option.none();
  return Option.match(argv, {
    onNone: () => Effect.fail(failure("Unsupported", `task ${task.name} needs a shell or has no execution`)),
    onSome: ([command, ...args]) =>
      command === undefined
        ? Effect.fail(failure("Unsupported", `task ${task.name} has an empty command`))
        : Effect.succeed(
            new RunTask({
              name: task.name,
              command,
              args,
              cwd,
            }),
          ),
  });
};
