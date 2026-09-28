/**
 * The extension host's wire contract: what the server asks a host worker and
 * what comes back. One schema set shared by both sides of the worker boundary,
 * and reused as the HTTP API's payloads so the app sees the same shapes.
 *
 * A view is VS Code's tree view reduced to data: every row the extension's
 * `TreeDataProvider` returns, with the actions its manifest attaches to that
 * kind of row. Rows are addressed by an id the host issues, because the real
 * element is a live object inside the extension and cannot cross the boundary.
 *
 * @internal
 */
import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/unstable/rpc";

/** How the app draws a page: a tree of rows (every VS Code view), sections
 * of facts with links to the plugin's other pages, or a collection (items in
 * groups and categories, filtered and pinned by the user). */
export const PageKind = Schema.Literals(["tree", "sections", "collection"]);
export type PageKind = typeof PageKind.Type;

/** A view an extension contributes and has registered a provider for, or a
 * plugin page. */
export class ViewInfo extends Schema.Class<ViewInfo>("ViewInfo")({
  id: Schema.String,
  name: Schema.String,
  /** The extension or plugin that contributes it. */
  extension: Schema.String,
  /** `codicon:<name>` or `sf:<SF Symbol>`, when the contributor gave one. */
  icon: Schema.optionalKey(Schema.String),
  kind: PageKind,
}) {}

/** Something a row offers: a command, titled and iconed from the manifest.
 * `inline` actions show on the row itself (a play button); the rest belong in
 * its long-press menu. */
export class ViewAction extends Schema.Class<ViewAction>("ViewAction")({
  command: Schema.String,
  title: Schema.String,
  icon: Schema.optionalKey(Schema.String),
  inline: Schema.Boolean,
}) {}

/** One row of a tree view. `icon` is a codicon name (`codicon:wrench`) or a
 * file the extension ships. `open` is what tapping the row does, if anything. */
export class ViewNode extends Schema.Class<ViewNode>("ViewNode")({
  id: Schema.String,
  label: Schema.String,
  description: Schema.optionalKey(Schema.String),
  tooltip: Schema.optionalKey(Schema.String),
  icon: Schema.optionalKey(Schema.String),
  contextValue: Schema.optionalKey(Schema.String),
  /** The file the row stands for, when it has one. With a generic file or
   * folder icon this is VS Code's cue to use the icon theme's icon for that
   * file, which is how a client should read it too. */
  resource: Schema.optionalKey(Schema.String),
  collapsible: Schema.Boolean,
  /** Starts expanded, as the extension asked (`TreeItemCollapsibleState.Expanded`). */
  expanded: Schema.Boolean,
  open: Schema.optionalKey(ViewAction),
  actions: Schema.Array(ViewAction),
}) {}

/** The extension asked to run a task. It is not run by the host: the caller
 * runs it through the process runner, which owns spawning and its safety
 * rules, and streams the output. */
export class RunTask extends Schema.TaggedClass<RunTask>()("RunTask", {
  name: Schema.String,
  command: Schema.String,
  args: Schema.Array(Schema.String),
  cwd: Schema.String,
}) {}

/** The extension asked to show a file (`vscode.open`, `showTextDocument`). */
export class OpenFile extends Schema.TaggedClass<OpenFile>()("OpenFile", {
  path: Schema.String,
  line: Schema.optionalKey(Schema.Number),
}) {}

/** The command ran and asked for nothing we act on; any messages it showed
 * the user are passed along. */
export class Completed extends Schema.TaggedClass<Completed>()("Completed", {
  messages: Schema.Array(Schema.String),
}) {}

export const InvokeResult = Schema.Union([RunTask, OpenFile, Completed]);
export type InvokeResult = typeof InvokeResult.Type;

/** The host could not answer: an extension failed to activate or threw, a
 * task needs something the runner does not do, or the host itself is down or
 * late. Crosses the worker boundary and the HTTP API, so it is a schema error. */
export class ExtensionHostError extends Schema.TaggedErrorClass<ExtensionHostError>()("ExtensionHostError", {
  reason: Schema.Literals(["ActivationFailed", "ProviderFailed", "Unsupported", "HostUnavailable", "Timeout"]),
  message: Schema.String,
}) {}

/** The request named something that is not there or not allowed: a view or
 * row the host does not know (a row id goes stale when its view refreshes), a
 * command that row does not offer, or a workspace outside the files root. */
export class ViewRequestError extends Schema.TaggedErrorClass<ViewRequestError>()("ViewRequestError", {
  reason: Schema.Literals(["UnknownView", "UnknownNode", "UnknownCommand", "BadWorkspace"]),
  message: Schema.String,
}) {}

export const HostCallError = Schema.Union([ExtensionHostError, ViewRequestError]);
export type HostCallError = typeof HostCallError.Type;

/** Every request names the workspace (a repo or worktree folder) it is about:
 * one host serves all of them, VS Code's multi-root window. */
export const viewsPayload = Schema.Struct({
  workspace: Schema.String,
});

export const childrenPayload = Schema.Struct({
  workspace: Schema.String,
  view: Schema.String,
  parent: Schema.optionalKey(Schema.String),
});

/** A whole tree for one workspace. `refresh` is how fresh it must be:
 * - `none`: whatever the extension has (instant);
 * - `ifChanged`: re-read only if a file behind the rows it last returned
 *   changed (a few stats; the cheap revalidation a cache wants);
 * - `force`: run the view's own refresh command (npm's `npm.refresh`), which
 *   re-scans everything (pull to refresh).
 */
export const treePayload = Schema.Struct({
  workspace: Schema.String,
  view: Schema.String,
  refresh: Schema.Literals(["none", "ifChanged", "force"]),
});
export type TreeRefresh = (typeof treePayload.Type)["refresh"];

export const invokePayload = Schema.Struct({
  workspace: Schema.String,
  view: Schema.String,
  node: Schema.String,
  command: Schema.String,
});

export const warmPayload = Schema.Struct({
  workspaces: Schema.Array(Schema.String),
});

/** One row of a whole tree, flat with its parent's id (absent at the top), so
 * the tree needs no recursive schema. In depth-first order. */
export class TreeEntry extends Schema.Class<TreeEntry>("TreeEntry")({
  parent: Schema.optionalKey(Schema.String),
  node: ViewNode,
}) {}

// ── Plugin pages ──────────────────────────────────────────────────────────────
// Pages a plugin fills with data (plugin/api.ts): sectionPages and collections.
// Actions are addressed by what they belong to (an item, a group, or the
// collection itself) and their command; a form's action carries its values.

/** A page reached from another page of its plugin (a sectioned page's links). */
export class PageLink extends Schema.Class<PageLink>("PageLink")({
  page: Schema.String,
  title: Schema.String,
  icon: Schema.optionalKey(Schema.String),
  kind: PageKind,
}) {}

export class SectionRow extends Schema.Class<SectionRow>("SectionRow")({
  label: Schema.String,
  value: Schema.String,
  /** Code-like (a version, a command), drawn monospaced. */
  mono: Schema.Boolean,
}) {}

export class PageSection extends Schema.Class<PageSection>("PageSection")({
  title: Schema.optionalKey(Schema.String),
  rows: Schema.Array(SectionRow),
}) {}

/** A page organized into sections: facts, then links to the plugin's pages that
 * open from here. */
export class PageSections extends Schema.Class<PageSections>("PageSections")({
  /** The page's title for this workspace, over the manifest's. */
  title: Schema.String,
  sections: Schema.Array(PageSection),
  links: Schema.Array(PageLink),
}) {}

export const FormFieldKind = Schema.Literals(["text", "code", "choice", "group"]);

export class FormOption extends Schema.Class<FormOption>("FormOption")({
  value: Schema.String,
  label: Schema.String,
}) {}

/** One field of a form: free text, code (monospaced, no autocorrect), a
 * choice among `options`, or one of the collection's groups (the app starts
 * it on the group the user is looking at). `value` is what it starts with. */
export class FormField extends Schema.Class<FormField>("FormField")({
  id: Schema.String,
  label: Schema.String,
  kind: FormFieldKind,
  value: Schema.String,
  placeholder: Schema.optionalKey(Schema.String),
  options: Schema.Array(FormOption),
}) {}

/** An action that asks for values first, drawn as a slide-up sheet. */
export class FormSpec extends Schema.Class<FormSpec>("FormSpec")({
  command: Schema.String,
  title: Schema.String,
  icon: Schema.optionalKey(Schema.String),
  submitTitle: Schema.String,
  fields: Schema.Array(FormField),
}) {}

/** A category the plugin assigns by default. */
export class CollectionCategory extends Schema.Class<CollectionCategory>("CollectionCategory")({
  id: Schema.String,
  name: Schema.String,
  icon: Schema.optionalKey(Schema.String),
}) {}

/** A group of items (a package of scripts). `resource` is the file behind
 * it, whose changes make the collection stale. */
export class CollectionGroup extends Schema.Class<CollectionGroup>("CollectionGroup")({
  key: Schema.String,
  title: Schema.String,
  detail: Schema.optionalKey(Schema.String),
  icon: Schema.optionalKey(Schema.String),
  resource: Schema.optionalKey(Schema.String),
  actions: Schema.Array(ViewAction),
}) {}

/** One item (a script). `title` is for people; `name` is what it is really
 * called. `categories` are the plugin's defaults, which the user's own
 * assignment replaces. `run` is the play button; tapping the item does it. */
export class CollectionItem extends Schema.Class<CollectionItem>("CollectionItem")({
  key: Schema.String,
  title: Schema.String,
  name: Schema.String,
  detail: Schema.optionalKey(Schema.String),
  icon: Schema.optionalKey(Schema.String),
  group: Schema.String,
  categories: Schema.Array(Schema.String),
  run: Schema.optionalKey(ViewAction),
  actions: Schema.Array(ViewAction),
  forms: Schema.Array(FormSpec),
}) {}

/** A collection as the plugin has it; the user's categories and pins are
 * kept beside it by the server (collections/state.ts). `create` is the form
 * for a new item. */
export class CollectionContent extends Schema.Class<CollectionContent>("CollectionContent")({
  groups: Schema.Array(CollectionGroup),
  items: Schema.Array(CollectionItem),
  categories: Schema.Array(CollectionCategory),
  /** What its groups are called, as a heading ("Packages"). */
  groupsTitle: Schema.String,
  create: Schema.optionalKey(FormSpec),
}) {}

export const pagePayload = Schema.Struct({
  workspace: Schema.String,
  page: Schema.String,
  refresh: Schema.Literals(["none", "ifChanged", "force"]),
});

/** What a collection action belongs to. */
export const CollectionTarget = Schema.Union([
  Schema.TaggedStruct("Item", { key: Schema.String }),
  Schema.TaggedStruct("Group", { key: Schema.String }),
  Schema.TaggedStruct("Whole", {}),
]);
export type CollectionTarget = typeof CollectionTarget.Type;

export const collectionInvokePayload = Schema.Struct({
  workspace: Schema.String,
  page: Schema.String,
  target: CollectionTarget,
  command: Schema.String,
  /** A form's values, by field id. */
  values: Schema.Record(Schema.String, Schema.String),
});

export class ExtensionHostRpcs extends RpcGroup.make(
  Rpc.make("Views", {
    payload: viewsPayload,
    success: Schema.Array(ViewInfo),
    error: HostCallError,
  }),
  Rpc.make("Children", {
    payload: childrenPayload,
    success: Schema.Array(ViewNode),
    error: HostCallError,
  }),
  Rpc.make("Tree", {
    payload: treePayload,
    success: Schema.Array(TreeEntry),
    error: HostCallError,
  }),
  Rpc.make("Invoke", {
    payload: invokePayload,
    success: InvokeResult,
    error: HostCallError,
  }),
  Rpc.make("PageSections", {
    payload: pagePayload,
    success: PageSections,
    error: HostCallError,
  }),
  Rpc.make("Collection", {
    payload: pagePayload,
    success: CollectionContent,
    error: HostCallError,
  }),
  Rpc.make("CollectionInvoke", {
    payload: collectionInvokePayload,
    success: InvokeResult,
    error: HostCallError,
  }),
  Rpc.make("Warm", {
    payload: warmPayload,
    success: Schema.Void,
    error: HostCallError,
  }),
) {}
