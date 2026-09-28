/**
 * The plugin authoring API: what a plugin's server module builds against.
 *
 * A plugin contributes pages as data, in the page kinds the app draws
 * natively (docs/handoffs/double-agent-repo-screen-and-plugin-system.md §22.2):
 *
 * - a **view**, a tree of nodes, the same rows VS Code extension views become;
 * - **sections**, a page organized into sections of facts, with links to the
 *   plugin's other pages;
 * - a **collection**, items in groups that the user sorts into categories,
 *   filters and pins (the app and server keep that part).
 *
 * Whatever a page offers to do is an action: an Effect that says what should
 * happen (run a task, open a file). A form is an action that asks for values
 * first. No plugin code runs in the app.
 *
 * Effects here may use the platform FileSystem and Path; the host provides
 * them. They must not reach for Node directly: the manifest's permissions are
 * what a user agreed to (§22).
 *
 * @internal
 */
import { Data, type Effect, type FileSystem, type Path } from "effect";
import type { InvokeResult } from "../extensionHost/protocol";

export { Completed, OpenFile, RunTask } from "../extensionHost/protocol";

/** Why a plugin could not produce a page or run an action. */
export class PluginError extends Data.TaggedError("PluginError")<{
  readonly message: string;
}> {}

/** The services a plugin's Effects may use. */
export type PluginServices = FileSystem.FileSystem | Path.Path;

/** What a page is being asked about. */
export interface PluginContext {
  /** The workspace (repo or worktree folder) the page is for. */
  readonly workspace: string;
}

/** Something a node offers. `inline` puts it on the row (a run action becomes
 * the play button); the rest go in the row's long-press menu. */
export interface PluginAction {
  readonly command: string;
  readonly title: string;
  /** `codicon:<name>`, the icon vocabulary views share. */
  readonly icon?: string;
  readonly inline?: boolean;
  readonly run: Effect.Effect<InvokeResult, PluginError, PluginServices>;
}

/** One node of a view's tree. `key` is stable among its siblings, so a row
 * keeps its identity across refreshes. */
export interface PluginNode {
  readonly key: string;
  readonly label: string;
  readonly description?: string;
  readonly tooltip?: string;
  readonly icon?: string;
  /** The file the node stands for; with a file icon, the app shows the file
   * type's own icon. */
  readonly resource?: string;
  readonly expanded?: boolean;
  /** What tapping the row does. */
  readonly open?: PluginAction;
  readonly actions?: ReadonlyArray<PluginAction>;
  readonly children?: ReadonlyArray<PluginNode>;
}

export interface PluginView {
  /** The whole tree for a workspace; empty means the view has nothing there
   * (and is not offered in that workspace's menu). */
  readonly tree: (context: PluginContext) => Effect.Effect<ReadonlyArray<PluginNode>, PluginError, PluginServices>;
}

// ── Sectioned pages ────────────────────────────────────────────────────────────

export interface PluginSectionRow {
  readonly label: string;
  readonly value: string;
  /** Code-like (a version, a command), drawn monospaced. */
  readonly mono?: boolean;
}

export interface PluginSection {
  readonly title?: string;
  readonly rows: ReadonlyArray<PluginSectionRow>;
}

export interface PluginSectionsContent {
  /** The page's title for this workspace, when it depends on what is there
   * ("PNPM" for a pnpm repo); the manifest's title otherwise. */
  readonly title?: string;
  readonly sections: ReadonlyArray<PluginSection>;
  /** The files the page was read from: when one changes, it is stale. */
  readonly resources: ReadonlyArray<string>;
}

export interface PluginSectionsPage {
  /** The page for a workspace; no sections means the page has nothing
   * there (and is not offered in that workspace's menu). Its links are the
   * plugin's pages whose `parent` is this one, from the manifest. */
  readonly content: (context: PluginContext) => Effect.Effect<PluginSectionsContent, PluginError, PluginServices>;
}

// ── Collections ───────────────────────────────────────────────────────────────

export interface PluginFormField {
  readonly id: string;
  readonly label: string;
  /** `text` by default; `code` is monospaced without autocorrect; `choice`
   * picks one of `options`; `group` picks one of the collection's groups (a
   * group key), starting on the one the user is looking at. */
  readonly kind?: "text" | "code" | "choice" | "group";
  readonly value?: string;
  readonly placeholder?: string;
  readonly options?: ReadonlyArray<{
    readonly value: string;
    readonly label: string;
  }>;
}

/** An action that asks for values first (a slide-up sheet in the app). */
export interface PluginForm {
  readonly command: string;
  readonly title: string;
  readonly icon?: string;
  /** The submit button's title; `Save` by default. */
  readonly submitTitle?: string;
  readonly fields: ReadonlyArray<PluginFormField>;
  readonly submit: (values: Readonly<Record<string, string>>) => Effect.Effect<InvokeResult, PluginError, PluginServices>;
}

export interface PluginCategory {
  readonly id: string;
  readonly name: string;
  readonly icon?: string;
}

export interface PluginGroup {
  /** Stable across refreshes and across worktrees of one repo (a path
   * relative to the workspace, say). */
  readonly key: string;
  readonly title: string;
  readonly detail?: string;
  readonly icon?: string;
  /** The file behind the group: when it changes, the collection is stale. */
  readonly resource?: string;
  readonly actions?: ReadonlyArray<PluginAction>;
}

export interface PluginItem {
  /** Stable across refreshes and across worktrees of one repo: the user's
   * categories and pins refer to it. */
  readonly key: string;
  /** For people ("Build iOS"). */
  readonly title: string;
  /** What it is really called ("build:ios"). */
  readonly name: string;
  readonly detail?: string;
  readonly icon?: string;
  /** Its group's key. */
  readonly group: string;
  /** The categories it belongs to until the user says otherwise. */
  readonly categories: ReadonlyArray<string>;
  /** What the play button and a tap do. */
  readonly run?: PluginAction;
  readonly actions?: ReadonlyArray<PluginAction>;
  readonly forms?: ReadonlyArray<PluginForm>;
}

export interface PluginCollectionContent {
  readonly groups: ReadonlyArray<PluginGroup>;
  readonly items: ReadonlyArray<PluginItem>;
  /** The form for a new item. */
  readonly create?: PluginForm;
}

export interface PluginCollection {
  /** The categories the plugin assigns; the user adds their own. */
  readonly categories: ReadonlyArray<PluginCategory>;
  /** What its groups are called, as a heading ("Packages"); `Groups` by
   * default. */
  readonly groupsTitle?: string;
  /** The collection for a workspace; no items means the page has nothing
   * there. */
  readonly content: (context: PluginContext) => Effect.Effect<PluginCollectionContent, PluginError, PluginServices>;
}

/** What a plugin module exports as its default: its pages' data, each under
 * the id a manifest page names (its `view`, or its own id). */
export interface PluginDefinition {
  readonly views?: Readonly<Record<string, PluginView>>;
  readonly sectionPages?: Readonly<Record<string, PluginSectionsPage>>;
  readonly collections?: Readonly<Record<string, PluginCollection>>;
}

/** Declare a plugin (an identity function, for the types). */
export const definePlugin = (definition: PluginDefinition): PluginDefinition => definition;
