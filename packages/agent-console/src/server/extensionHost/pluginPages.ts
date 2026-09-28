/**
 * Plugins in the host: loading them and turning their views into rows.
 *
 * A plugin's view is a tree of nodes it builds from data (plugin/api.ts); here
 * it becomes the same flat rows a VS Code extension's tree view becomes, so
 * the `/views` protocol and the app's native tree screen serve both. Row ids
 * come from the nodes' keys, so a row keeps its id across refreshes.
 *
 * @internal
 */
import { Effect, FileSystem, Path, Predicate, Schema } from "effect";
import type { PluginAction, PluginDefinition, PluginNode, PluginServices, PluginView } from "../plugin/api";
import type { PluginError } from "../plugin/api";
import { manifestFile, pluginManifest, type PluginManifest, type PluginPage } from "../plugin/manifest";
import { ExtensionHostError, TreeEntry, ViewAction, ViewNode, type InvokeResult } from "./protocol";

export interface LoadedPlugin {
  readonly dir: string;
  readonly manifest: PluginManifest;
  readonly definition: PluginDefinition;
}

/** A tree page of a loaded plugin, addressed by a view id no VS Code view can
 * take (`<plugin id>/<view>`). */
export interface PluginTreePage {
  readonly viewId: string;
  readonly page: PluginPage;
  readonly plugin: LoadedPlugin;
  readonly view: PluginView;
}

const failure = (message: string) =>
  new ExtensionHostError({
    reason: "ActivationFailed",
    message,
  });

const isPluginView = (value: unknown): value is PluginView => Predicate.hasProperty(value, "tree") && Predicate.isFunction(value.tree);

/** A module's default export, if it is a plugin: a `views` record of views. */
const isPluginDefinition = (value: unknown): value is PluginDefinition =>
  Predicate.hasProperty(value, "views") && Predicate.isObject(value.views) && Object.values(value.views).every(isPluginView);

/** Read a plugin's manifest and import its server module. */
export const loadPlugin = (dir: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const manifest = yield* fs
      .readFileString(path.join(dir, manifestFile))
      .pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(pluginManifest))),
        Effect.mapError((cause) => failure(`${dir}: unreadable ${manifestFile} (${String(cause)})`)),
      );
    const url = yield* path.toFileUrl(path.join(dir, manifest.main)).pipe(Effect.mapError((cause) => failure(`${manifest.id}: ${String(cause)}`)));
    const module = yield* Effect.tryPromise({
      try: () => import(url.href),
      catch: (cause) => failure(`${manifest.id} failed to load: ${cause instanceof Error ? cause.message : String(cause)}`),
    });
    const definition: unknown = Predicate.hasProperty(module, "default") ? module.default : undefined;
    if (!isPluginDefinition(definition)) return yield* failure(`${manifest.id}: its main module's default export is not a plugin (definePlugin)`);
    const missing = (manifest.contributes.pages ?? []).filter((page) => page.kind === "tree" && definition.views[page.view ?? page.id] === undefined);
    if (missing.length > 0) {
      return yield* failure(`${manifest.id}: pages with no view: ${missing.map((page) => page.id).join(", ")}`);
    }
    const loaded: LoadedPlugin = {
      dir,
      manifest,
      definition,
    };
    return loaded;
  });

/** Every tree page the loaded plugins contribute. */
export const treePages = (plugins: ReadonlyArray<LoadedPlugin>): ReadonlyArray<PluginTreePage> =>
  plugins.flatMap((plugin) =>
    (plugin.manifest.contributes.pages ?? []).flatMap((page) => {
      const view = plugin.definition.views[page.view ?? page.id];
      return page.kind === "tree" && view !== undefined ? [{ viewId: `${plugin.manifest.id}/${page.view ?? page.id}`, page, plugin, view }] : [];
    }),
  );

/** A row produced from a plugin node, with the Effects its actions run. */
export interface PluginRow {
  readonly entry: TreeEntry;
  readonly runs: ReadonlyMap<string, PluginAction["run"]>;
}

const nodeData = Schema.Struct({
  key: Schema.String,
  label: Schema.String,
  description: Schema.optionalKey(Schema.String),
  tooltip: Schema.optionalKey(Schema.String),
  icon: Schema.optionalKey(Schema.String),
  resource: Schema.optionalKey(Schema.String),
  expanded: Schema.optionalKey(Schema.Boolean),
});

const toAction = (action: PluginAction, inline: boolean): ViewAction =>
  new ViewAction({
    command: action.command,
    title: action.title,
    ...(action.icon === undefined ? {} : { icon: action.icon }),
    inline,
  });

/**
 * A plugin's tree as flat rows, depth first, each with its parent's id. A
 * node's data is decoded, since a plugin is not ours to trust to be well
 * formed; a malformed node fails the view with what was wrong.
 */
export const flattenPluginTree = (
  viewId: string,
  workspace: string,
  nodes: ReadonlyArray<PluginNode>,
  parent: string | undefined,
  prefix: string,
): Effect.Effect<ReadonlyArray<PluginRow>, ExtensionHostError> =>
  Effect.forEach(nodes, (node) =>
    Schema.decodeUnknownEffect(nodeData)(node).pipe(
      Effect.mapError(
        (cause) =>
          new ExtensionHostError({
            reason: "ProviderFailed",
            message: `${viewId}: a node is malformed: ${cause.message}`,
          }),
      ),
      Effect.flatMap((data) => {
        const path = `${prefix}/${data.key}`;
        const id = `${viewId}#${workspace}#${path}`;
        const actions = node.actions ?? [];
        const open = node.open;
        const children = node.children ?? [];
        const row: PluginRow = {
          entry: new TreeEntry({
            ...(parent === undefined ? {} : { parent }),
            node: new ViewNode({
              id,
              label: data.label,
              ...(data.description === undefined ? {} : { description: data.description }),
              ...(data.tooltip === undefined ? {} : { tooltip: data.tooltip }),
              ...(data.icon === undefined ? {} : { icon: data.icon }),
              ...(data.resource === undefined ? {} : { resource: data.resource }),
              collapsible: children.length > 0,
              expanded: data.expanded === true,
              ...(open === undefined ? {} : { open: toAction(open, false) }),
              actions: actions.map((action) => toAction(action, action.inline === true)),
            }),
          }),
          runs: new Map([...(open === undefined ? [] : [open]), ...actions].map((action): readonly [string, PluginAction["run"]] => [action.command, action.run])),
        };
        return flattenPluginTree(viewId, workspace, children, id, path).pipe(Effect.map((below) => [row, ...below]));
      }),
    ),
  ).pipe(Effect.map((rows) => rows.flat()));

/** Run one of a plugin row's actions. */
export const runPluginAction = (run: PluginAction["run"]): Effect.Effect<InvokeResult, ExtensionHostError, PluginServices> =>
  run.pipe(
    Effect.mapError(
      (cause: PluginError) =>
        new ExtensionHostError({
          reason: "ProviderFailed",
          message: cause.message,
        }),
    ),
  );
