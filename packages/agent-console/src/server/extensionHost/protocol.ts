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

/** A view an extension contributes and has registered a provider for. */
export class ViewInfo extends Schema.Class<ViewInfo>("ViewInfo")({
  id: Schema.String,
  name: Schema.String,
  extension: Schema.String,
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

export const childrenPayload = Schema.Struct({
  view: Schema.String,
  parent: Schema.optionalKey(Schema.String),
});

export const invokePayload = Schema.Struct({
  view: Schema.String,
  node: Schema.String,
  command: Schema.String,
});

export class ExtensionHostRpcs extends RpcGroup.make(
  Rpc.make("Views", {
    success: Schema.Array(ViewInfo),
    error: HostCallError,
  }),
  Rpc.make("Children", {
    payload: childrenPayload,
    success: Schema.Array(ViewNode),
    error: HostCallError,
  }),
  Rpc.make("Invoke", {
    payload: invokePayload,
    success: InvokeResult,
    error: HostCallError,
  }),
) {}
