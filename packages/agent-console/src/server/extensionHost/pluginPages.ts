/**
 * Plugins in the host: loading them and turning their pages into what the
 * app draws.
 *
 * - A view (a tree of nodes, plugin/api.ts) becomes the same flat rows a VS
 *   Code extension's tree view becomes, so the `/views` protocol and the
 *   app's native tree screen serve both. Row ids come from the nodes' keys, so
 *   a row keeps its id across refreshes.
 * - A summary becomes sections of facts, with links to the plugin's pages
 *   that open from it.
 * - A collection becomes its groups and items, each action addressed by what
 *   it belongs to and its command.
 *
 * Whatever a plugin returns is decoded, since a plugin is not ours to trust
 * to be well formed; malformed data fails the page with what was wrong.
 *
 * @internal
 */
import { Effect, FileSystem, Path, Predicate, Schema } from "effect";
import type {
  PluginAction,
  PluginCollection,
  PluginCollectionContent,
  PluginDefinition,
  PluginForm,
  PluginNode,
  PluginServices,
  PluginSummary,
  PluginSummaryContent,
  PluginView,
} from "../plugin/api";
import type { PluginError } from "../plugin/api";
import { manifestFile, pluginManifest, type PluginManifest, type PluginPage } from "../plugin/manifest";
import { CollectionContent, ExtensionHostError, PageLink, Summary, TreeEntry, ViewAction, ViewNode, type CollectionTarget, type InvokeResult } from "./protocol";

export interface LoadedPlugin {
  readonly dir: string;
  readonly manifest: PluginManifest;
  readonly definition: PluginDefinition;
}

/** A page of a loaded plugin with what fills it, addressed by an id no VS Code
 * view can take (`<plugin id>/<page id>`). */
export type PluginPageEntry =
  | {
      readonly kind: "tree";
      readonly viewId: string;
      readonly page: PluginPage;
      readonly plugin: LoadedPlugin;
      readonly view: PluginView;
    }
  | {
      readonly kind: "summary";
      readonly viewId: string;
      readonly page: PluginPage;
      readonly plugin: LoadedPlugin;
      readonly summary: PluginSummary;
    }
  | {
      readonly kind: "collection";
      readonly viewId: string;
      readonly page: PluginPage;
      readonly plugin: LoadedPlugin;
      readonly collection: PluginCollection;
    };

/** A tree page, for the `/views` protocol. */
export type PluginTreePage = Extract<PluginPageEntry, { readonly kind: "tree" }>;

const failure = (message: string) =>
  new ExtensionHostError({
    reason: "ActivationFailed",
    message,
  });

const providerFailure = (message: string) =>
  new ExtensionHostError({
    reason: "ProviderFailed",
    message,
  });

const isRecordOf =
  <A>(is: (value: unknown) => value is A) =>
  (value: unknown): boolean =>
    value === undefined || (Predicate.isObject(value) && Object.values(value).every(is));

const isPluginView = (value: unknown): value is PluginView => Predicate.hasProperty(value, "tree") && Predicate.isFunction(value.tree);

const isPluginSummary = (value: unknown): value is PluginSummary => Predicate.hasProperty(value, "summary") && Predicate.isFunction(value.summary);

const isPluginCollection = (value: unknown): value is PluginCollection =>
  Predicate.hasProperty(value, "content") && Predicate.isFunction(value.content) && Predicate.hasProperty(value, "categories") && Array.isArray(value.categories);

/** A module's default export, if it is a plugin: records of views, summaries
 * and collections, each optional. */
const isPluginDefinition = (value: unknown): value is PluginDefinition =>
  Predicate.isObject(value) &&
  isRecordOf(isPluginView)(Predicate.hasProperty(value, "views") ? value.views : undefined) &&
  isRecordOf(isPluginSummary)(Predicate.hasProperty(value, "summaries") ? value.summaries : undefined) &&
  isRecordOf(isPluginCollection)(Predicate.hasProperty(value, "collections") ? value.collections : undefined);

/** A page with what fills it, if the plugin defines it. */
const pageEntry = (plugin: LoadedPlugin, page: PluginPage): PluginPageEntry | undefined => {
  const name = page.view ?? page.id;
  const viewId = `${plugin.manifest.id}/${page.id}`;
  const { definition } = plugin;
  switch (page.kind) {
    case "tree": {
      const view = definition.views?.[name];
      return view === undefined ? undefined : { kind: "tree", viewId, page, plugin, view };
    }
    case "summary": {
      const summary = definition.summaries?.[name];
      return summary === undefined ? undefined : { kind: "summary", viewId, page, plugin, summary };
    }
    case "collection": {
      const collection = definition.collections?.[name];
      return collection === undefined ? undefined : { kind: "collection", viewId, page, plugin, collection };
    }
  }
};

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
    const loaded: LoadedPlugin = {
      dir,
      manifest,
      definition,
    };
    const pages = manifest.contributes.pages ?? [];
    const missing = pages.filter((page) => pageEntry(loaded, page) === undefined);
    if (missing.length > 0) {
      return yield* failure(`${manifest.id}: pages its module does not fill: ${missing.map((page) => `${page.id} (${page.kind})`).join(", ")}`);
    }
    const orphans = pages.filter((page) => page.parent !== undefined && !pages.some((other) => other.id === page.parent));
    if (orphans.length > 0) {
      return yield* failure(`${manifest.id}: pages whose parent is not one of its pages: ${orphans.map((page) => page.id).join(", ")}`);
    }
    return loaded;
  });

/** Every page the loaded plugins contribute. */
export const pluginPages = (plugins: ReadonlyArray<LoadedPlugin>): ReadonlyArray<PluginPageEntry> =>
  plugins.flatMap((plugin) =>
    (plugin.manifest.contributes.pages ?? []).flatMap((page) => {
      const entry = pageEntry(plugin, page);
      return entry === undefined ? [] : [entry];
    }),
  );

/** The pages that open from `entry` (its plugin's pages naming it parent). */
export const linksOf = (entry: PluginPageEntry): ReadonlyArray<PageLink> =>
  (entry.plugin.manifest.contributes.pages ?? [])
    .filter((page) => page.parent === entry.page.id)
    .map(
      (page) =>
        new PageLink({
          page: `${entry.plugin.manifest.id}/${page.id}`,
          title: page.title,
          ...(page.icon === undefined ? {} : { icon: page.icon }),
          kind: page.kind,
        }),
    );

/** A summary as the app draws it. */
export const toSummary = (entry: PluginPageEntry, content: PluginSummaryContent): Effect.Effect<Summary, ExtensionHostError> =>
  Schema.decodeUnknownEffect(Summary)({
    title: content.title ?? entry.page.title,
    sections: content.sections.map((section) => ({
      ...(section.title === undefined ? {} : { title: section.title }),
      rows: section.rows.map((row) => ({
        label: row.label,
        value: row.value,
        mono: row.mono === true,
      })),
    })),
    links: linksOf(entry),
  }).pipe(Effect.mapError((cause) => providerFailure(`${entry.viewId}: its summary is malformed: ${cause.message}`)));

/** What an action does, given a form's values (plain actions ignore them). */
export type CollectionRun = (values: Readonly<Record<string, string>>) => Effect.Effect<InvokeResult, PluginError, PluginServices>;

/** A collection's actions, by target key (`targetKey`) then command. */
export type CollectionRuns = ReadonlyMap<string, ReadonlyMap<string, CollectionRun>>;

export const targetKey = (target: CollectionTarget): string =>
  target._tag === "Item" ? `item ${target.key}` : target._tag === "Group" ? `group ${target.key}` : "whole";

const actionData = (action: PluginAction, inline: boolean) => ({
  command: action.command,
  title: action.title,
  ...(action.icon === undefined ? {} : { icon: action.icon }),
  inline,
});

const formData = (form: PluginForm) => ({
  command: form.command,
  title: form.title,
  ...(form.icon === undefined ? {} : { icon: form.icon }),
  submitTitle: form.submitTitle ?? "Save",
  fields: form.fields.map((field) => ({
    id: field.id,
    label: field.label,
    kind: field.kind ?? "text",
    value: field.value ?? "",
    ...(field.placeholder === undefined ? {} : { placeholder: field.placeholder }),
    options: field.options ?? [],
  })),
});

const runsOf = (actions: ReadonlyArray<PluginAction>, forms: ReadonlyArray<PluginForm>): ReadonlyMap<string, CollectionRun> =>
  new Map([
    ...actions.map((action): readonly [string, CollectionRun] => [action.command, () => action.run]),
    ...forms.map((form): readonly [string, CollectionRun] => [form.command, form.submit]),
  ]);

/** A collection as the app draws it, with the Effects its actions run. */
export const toCollection = (
  entry: Extract<PluginPageEntry, { readonly kind: "collection" }>,
  content: PluginCollectionContent,
): Effect.Effect<{ readonly content: CollectionContent; readonly runs: CollectionRuns }, ExtensionHostError> =>
  Schema.decodeUnknownEffect(CollectionContent)({
    groups: content.groups.map((group) => ({
      key: group.key,
      title: group.title,
      ...(group.detail === undefined ? {} : { detail: group.detail }),
      ...(group.icon === undefined ? {} : { icon: group.icon }),
      ...(group.resource === undefined ? {} : { resource: group.resource }),
      actions: (group.actions ?? []).map((action) => actionData(action, false)),
    })),
    items: content.items.map((item) => ({
      key: item.key,
      title: item.title,
      name: item.name,
      ...(item.detail === undefined ? {} : { detail: item.detail }),
      ...(item.icon === undefined ? {} : { icon: item.icon }),
      group: item.group,
      categories: item.categories,
      ...(item.run === undefined ? {} : { run: actionData(item.run, true) }),
      actions: (item.actions ?? []).map((action) => actionData(action, false)),
      forms: (item.forms ?? []).map(formData),
    })),
    categories: entry.collection.categories.map((category) => ({
      id: category.id,
      name: category.name,
      ...(category.icon === undefined ? {} : { icon: category.icon }),
    })),
    groupsTitle: entry.collection.groupsTitle ?? "Groups",
    ...(content.create === undefined ? {} : { create: formData(content.create) }),
  }).pipe(
    Effect.mapError((cause) => providerFailure(`${entry.viewId}: its collection is malformed: ${cause.message}`)),
    Effect.map((decoded) => ({
      content: decoded,
      runs: new Map([
        ...content.groups.map((group): readonly [string, ReadonlyMap<string, CollectionRun>] => [targetKey({ _tag: "Group", key: group.key }), runsOf(group.actions ?? [], [])]),
        ...content.items.map((item): readonly [string, ReadonlyMap<string, CollectionRun>] => [
          targetKey({ _tag: "Item", key: item.key }),
          runsOf([...(item.run === undefined ? [] : [item.run]), ...(item.actions ?? [])], item.forms ?? []),
        ]),
        [targetKey({ _tag: "Whole" }), runsOf([], content.create === undefined ? [] : [content.create])],
      ]),
    })),
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
