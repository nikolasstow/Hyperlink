/**
 * The plugin authoring API: what a plugin's server module builds against.
 *
 * A plugin contributes views as data. A view is a tree of nodes, each with
 * the actions it offers; an action is an Effect that says what should happen
 * (run a task, open a file). The host turns the tree into the rows the app
 * draws natively (the same `/views` protocol VS Code extension views use), so
 * no plugin code runs in the app.
 *
 * Effects here may use the platform FileSystem and Path; the host provides
 * them. They must not reach for Node directly: the manifest's permissions are
 * what a user agreed to (docs/handoffs/double-agent-repo-screen-and-plugin-system.md §22).
 *
 * @internal
 */
import { Data, type Effect, type FileSystem, type Path } from "effect";
import type { InvokeResult } from "../extensionHost/protocol";

export { Completed, OpenFile, RunTask } from "../extensionHost/protocol";

/** Why a plugin could not produce its tree or run an action. */
export class PluginError extends Data.TaggedError("PluginError")<{
  readonly message: string;
}> {}

/** The services a plugin's Effects may use. */
export type PluginServices = FileSystem.FileSystem | Path.Path;

/** What a view is being asked about. */
export interface PluginContext {
  /** The workspace (repo or worktree folder) the view is for. */
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

/** What a plugin module exports as its default. */
export interface PluginDefinition {
  readonly views: Readonly<Record<string, PluginView>>;
}

/** Declare a plugin (an identity function, for the types). */
export const definePlugin = (definition: PluginDefinition): PluginDefinition => definition;
