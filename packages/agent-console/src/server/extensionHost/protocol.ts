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
  /** It removes something (uninstall): the app asks first. */
  destructive: Schema.optionalKey(Schema.Boolean),
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

/** A plugin asked to open a web page (a package on npmjs.com). */
export class OpenUrl extends Schema.TaggedClass<OpenUrl>()("OpenUrl", {
  url: Schema.String,
}) {}

export const InvokeResult = Schema.Union([RunTask, OpenFile, OpenUrl, Completed]);
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

// ── Plugin pages ──────────────────────────────────────────────────────────────
// Pages a plugin fills with data (plugin/api.ts): pages organized into
// sections, and collections. Actions are addressed by what they belong to (an
// item, a group, the collection, or a block of a page) and their command; a
// form's action carries its values.

/** What a page is about, beyond the workspace: which package, which
 * dependency. A page's own words; the app passes them back as given. For a
 * collection, `group` and `category` open it on that filter. */
export const PageParams = Schema.Record(Schema.String, Schema.String);

/** A page reached from another page of its plugin, with its params. */
export class PageLink extends Schema.Class<PageLink>("PageLink")({
  page: Schema.String,
  params: PageParams,
  title: Schema.String,
  icon: Schema.optionalKey(Schema.String),
  /** Secondary text beside the title (a count). */
  detail: Schema.optionalKey(Schema.String),
  kind: PageKind,
}) {}

export class SectionRow extends Schema.Class<SectionRow>("SectionRow")({
  label: Schema.String,
  value: Schema.String,
  /** Code-like (a version, a command), drawn monospaced. */
  mono: Schema.Boolean,
  /** Long text (a description), on its own line below the label. */
  stacked: Schema.Boolean,
}) {}

/** Facts, as label and value rows, then buttons to other pages of the
 * plugin, all in one card. */
export class FactsBlock extends Schema.TaggedClass<FactsBlock>()("Facts", {
  title: Schema.optionalKey(Schema.String),
  rows: Schema.Array(SectionRow),
  links: Schema.Array(PageLink),
  /** A page the whole card opens (its last row carries the chevron). */
  opens: Schema.optionalKey(PageLink),
}) {}

/** A button that opens another page of the plugin. */
export class LinkBlock extends Schema.TaggedClass<LinkBlock>()("Link", {
  link: PageLink,
}) {}

/** The user's pins on a collection page of the plugin, with a button to the
 * whole collection. With nothing pinned and nothing suggested, the app leaves
 * it out. */
export class PinnedBlock extends Schema.TaggedClass<PinnedBlock>()("Pinned", {
  collection: PageLink,
  title: Schema.String,
  viewAll: Schema.String,
  /** Only the pins in this group (a package's own page). */
  group: Schema.optionalKey(Schema.String),
  /** Items to show while nothing is pinned: the plugin's best picks. */
  suggestions: Schema.Array(Schema.String),
}) {}

/** A card: facts about something, opening a page, with its own actions (an
 * update button). `key` addresses its actions. */
export class CardBlock extends Schema.TaggedClass<CardBlock>()("Card", {
  key: Schema.String,
  title: Schema.String,
  icon: Schema.optionalKey(Schema.String),
  rows: Schema.Array(SectionRow),
  opens: Schema.optionalKey(PageLink),
  actions: Schema.Array(ViewAction),
}) {}

/** Buttons for what can be done here (update, uninstall), in one card.
 * `key` addresses them. */
export class ActionsBlock extends Schema.TaggedClass<ActionsBlock>()("Actions", {
  key: Schema.String,
  title: Schema.optionalKey(Schema.String),
  actions: Schema.Array(ViewAction),
}) {}

export const PageBlock = Schema.Union([FactsBlock, LinkBlock, PinnedBlock, CardBlock, ActionsBlock]);
export type PageBlock = typeof PageBlock.Type;

/** A page organized into blocks, top to bottom, with what its 3-dot menu
 * offers and what its + menu adds (forms, both addressed as the block
 * `menu`). */
export class PageSections extends Schema.Class<PageSections>("PageSections")({
  /** The page's title for this workspace, over the manifest's. */
  title: Schema.String,
  blocks: Schema.Array(PageBlock),
  menu: Schema.Array(FormSpec),
  add: Schema.Array(FormSpec),
}) {}

/** The block a page's 3-dot menu forms are addressed by. */
export const pageMenuBlock = "menu";

export const sectionsInvokePayload = Schema.Struct({
  workspace: Schema.String,
  page: Schema.String,
  params: PageParams,
  block: Schema.String,
  command: Schema.String,
  /** A form's values, by field id. */
  values: Schema.Record(Schema.String, Schema.String),
});

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
  /** What tapping it does when it does not run (open its web page). */
  open: Schema.optionalKey(ViewAction),
  /** The page tapping it opens, over `open` (a dependency's own page). */
  opens: Schema.optionalKey(PageLink),
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
  /** Whether its items can be pinned (scripts can; dependencies cannot). */
  pinnable: Schema.Boolean,
  /** What a pinned item's scopes are called, when it has them: its group's
   * page ("Workspace Package") and the top page ("Repo"). */
  pinScopes: Schema.optionalKey(
    Schema.Struct({
      group: Schema.String,
      top: Schema.String,
    }),
  ),
  /** Whether the plugin searches beyond the collection (a registry), and
   * what the search field says. */
  search: Schema.optionalKey(
    Schema.Struct({
      placeholder: Schema.String,
      /** Headings for what matched in the collection, and beyond it. */
      inCollection: Schema.String,
      beyond: Schema.String,
    }),
  ),
  create: Schema.optionalKey(FormSpec),
}) {}

export const pagePayload = Schema.Struct({
  workspace: Schema.String,
  page: Schema.String,
  params: PageParams,
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

export const collectionSearchPayload = Schema.Struct({
  workspace: Schema.String,
  page: Schema.String,
  query: Schema.String,
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
  Rpc.make("Sections", {
    payload: pagePayload,
    success: PageSections,
    error: HostCallError,
  }),
  Rpc.make("Collection", {
    payload: pagePayload,
    success: CollectionContent,
    error: HostCallError,
  }),
  Rpc.make("SectionsInvoke", {
    payload: sectionsInvokePayload,
    success: InvokeResult,
    error: HostCallError,
  }),
  Rpc.make("CollectionSearch", {
    payload: collectionSearchPayload,
    success: Schema.Array(CollectionItem),
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
