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
import { Completed, ExtensionHostError, OpenFile, RunTask, ViewAction, ViewInfo, ViewNode, ViewRequestError, type InvokeResult } from "./protocol";
import { ProcessExecution, ShellExecution, Task, Uri, makeRegistry, makeVscode, type Registry } from "./shim";
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
 * attributed to it. */
const settleWindow = Duration.millis(250);

// ── The host ───────────────────────────────────────────────────────────────────

export interface HostOptions {
  readonly workspace: string;
  readonly extensions: ReadonlyArray<string>;
}

/** Activate the extensions and return the protocol's handlers. */
export const makeHost = (options: HostOptions) =>
  Effect.gen(function* () {
    const loaded = yield* Effect.forEach(options.extensions, loadManifest);
    const registry = makeRegistry();
    const shimRuntime = ManagedRuntime.make(NodeServices.layer);
    yield* Effect.addFinalizer(() => shimRuntime.disposeEffect);
    const vscode = makeVscode({
      workspaceRoot: options.workspace,
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
    const ownerOf = (view: string) => Option.fromUndefinedOr(declared.find((entry) => entry.view.id === view));

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

    const Views = () =>
      Effect.succeed(
        declared
          .filter((entry) => isTreeProvider(registry.treeViews.get(entry.view.id)))
          .map(
            (entry) =>
              new ViewInfo({
                id: entry.view.id,
                name: entry.extension.localize(entry.view.name ?? entry.view.id),
                extension: entry.extension.id,
              }),
          ),
      );

    const Children = (payload: { readonly view: string; readonly parent?: string }) =>
      Effect.gen(function* () {
        const tree = yield* provider(payload.view);
        const owner = yield* Option.match(ownerOf(payload.view), {
          onNone: () => Effect.fail(rejected("UnknownView", `no manifest declares ${payload.view}`)),
          onSome: Effect.succeed,
        });
        const parentRow = payload.parent === undefined ? Option.none<Row>() : yield* rowById(payload.parent);
        if (payload.parent !== undefined && Option.isNone(parentRow)) return yield* rejected("UnknownNode", `unknown row ${payload.parent}`);
        const parentElement = Option.match(parentRow, {
          onNone: () => undefined,
          onSome: (row) => row.element,
        });
        const raw = yield* call("getChildren", () => tree.getChildren(parentElement));
        const elements = Array.isArray(raw) ? raw : [];
        return yield* Effect.forEach(elements, (element) =>
          Effect.gen(function* () {
            const itemRaw = yield* call("getTreeItem", () => tree.getTreeItem(element));
            const item = yield* Schema.decodeUnknownEffect(treeItemSchema)(itemRaw).pipe(
              Effect.mapError((cause) => failure("ProviderFailed", `a tree item did not decode: ${cause.message}`)),
            );
            const actions = actionsFor(owner.extension, payload.view, item.contextValue);
            const openCommand = item.command;
            const id = yield* remember(payload.view, element, {
              view: payload.view,
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
            const resource = item.resourceUri instanceof Uri ? item.resourceUri.fsPath.split("/").at(-1) : undefined;
            const description = Predicate.isString(item.description) ? item.description : undefined;
            const tooltip = text(item.tooltip);
            const icon = iconName(item.iconPath);
            return new ViewNode({
              id,
              label: text(item.label) ?? resource ?? "",
              ...(description === undefined ? {} : { description }),
              ...(tooltip === undefined ? {} : { tooltip }),
              ...(icon === undefined ? {} : { icon }),
              ...(item.contextValue === undefined ? {} : { contextValue: item.contextValue }),
              collapsible: (item.collapsibleState ?? 0) > 0,
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
            });
          }),
        );
      });

    const Invoke = (payload: { readonly view: string; readonly node: string; readonly command: string }) =>
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
        // then calls another command without awaiting it), so what a command
        // set off can land after it resolves. Give it a moment to land.
        yield* Effect.sleep(settleWindow);

        const task = registry.executedTasks.slice(tasksBefore).at(-1);
        if (task instanceof Task) return yield* toRunTask(task, options.workspace);
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
      Invoke,
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
