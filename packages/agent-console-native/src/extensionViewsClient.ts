/**
 * Client for extension views (VS Code tree views run by the backend's extension
 * host, `/views/*` on the Effect API server) and for the process runner that
 * runs what their actions ask for (`/processes` on the vite backend).
 *
 * Same conventions as extensionsClient: plain `fetch` with a string body,
 * `Schema`-decoded responses, and a non-2xx surfaced with the server's message.
 * The schemas mirror `packages/agent-console/src/server/extensionHost/protocol.ts`,
 * the wire contract's source of truth.
 *
 * @internal
 */
import { Schema } from "effect";
import { fetch as streamingFetch } from "expo/fetch";
import { base, request } from "./extensionsClient";

const viewInfo = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  extension: Schema.String,
});
export type ViewInfo = typeof viewInfo.Type;

const viewAction = Schema.Struct({
  command: Schema.String,
  title: Schema.String,
  icon: Schema.optionalKey(Schema.String),
  inline: Schema.Boolean,
});
export type ViewAction = typeof viewAction.Type;

const viewNode = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  description: Schema.optionalKey(Schema.String),
  tooltip: Schema.optionalKey(Schema.String),
  icon: Schema.optionalKey(Schema.String),
  contextValue: Schema.optionalKey(Schema.String),
  resource: Schema.optionalKey(Schema.String),
  collapsible: Schema.Boolean,
  open: Schema.optionalKey(viewAction),
  actions: Schema.Array(viewAction),
});
export type ViewNode = typeof viewNode.Type;

const runTask = Schema.TaggedStruct("RunTask", {
  name: Schema.String,
  command: Schema.String,
  args: Schema.Array(Schema.String),
  cwd: Schema.String,
});
export type RunTask = typeof runTask.Type;

const invokeResult = Schema.Union([
  runTask,
  Schema.TaggedStruct("OpenFile", {
    path: Schema.String,
    line: Schema.optionalKey(Schema.Number),
  }),
  Schema.TaggedStruct("Completed", {
    messages: Schema.Array(Schema.String),
  }),
]);
export type InvokeResult = typeof invokeResult.Type;

const post = (url: string, body: object) =>
  request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

/** The views extensions offer for a workspace (a repo or worktree folder). */
export const listViews = async (apiBase: string, workspace: string): Promise<ReadonlyArray<ViewInfo>> =>
  Schema.decodeUnknownSync(Schema.Array(viewInfo))(await post(`${base(apiBase)}/views/list`, { workspace }));

/** A view's rows under `parent`, or its top level. */
export const viewChildren = async (apiBase: string, workspace: string, view: string, parent: string | undefined): Promise<ReadonlyArray<ViewNode>> =>
  Schema.decodeUnknownSync(Schema.Array(viewNode))(
    await post(`${base(apiBase)}/views/children`, {
      workspace,
      view,
      ...(parent === undefined ? {} : { parent }),
    }),
  );

/** Run one of a row's actions and learn what it asked for. */
export const invokeViewAction = async (apiBase: string, workspace: string, view: string, node: string, command: string): Promise<InvokeResult> =>
  Schema.decodeUnknownSync(invokeResult)(
    await post(`${base(apiBase)}/views/invoke`, {
      workspace,
      view,
      node,
      command,
    }),
  );

// ── Process runner ─────────────────────────────────────────────────────────────

const processSummary = Schema.Struct({
  id: Schema.String,
});

/** Start a task on the backend's process runner; returns the process id. */
export const startTask = async (backend: string, task: RunTask): Promise<string> =>
  Schema.decodeUnknownSync(processSummary)(
    await post(`${base(backend)}/processes`, {
      command: task.command,
      args: task.args,
      cwd: task.cwd,
    }),
  ).id;

export const stopProcess = async (backend: string, id: string): Promise<void> => {
  await post(`${base(backend)}/processes/${encodeURIComponent(id)}/stop`, {});
};

const streamLine = Schema.Struct({
  stream: Schema.optionalKey(Schema.String),
  text: Schema.String,
});

const streamExit = Schema.Struct({
  exitCode: Schema.optionalKey(Schema.Number),
});

export type ProcessEvent =
  | { readonly kind: "line"; readonly text: string; readonly stderr: boolean }
  | { readonly kind: "exit"; readonly exitCode: number | undefined };

/**
 * Follow a process's output: the backlog first, then live lines, then its
 * exit. Server-sent events read through `expo/fetch`, whose body streams
 * (React Native's own `fetch` buffers the whole response). Resolves when the
 * stream ends; rejects if it cannot be read, and `signal` stops it.
 */
export const followProcess = async (backend: string, id: string, onEvent: (event: ProcessEvent) => void, signal: AbortSignal): Promise<void> => {
  const response = await streamingFetch(`${base(backend)}/processes/${encodeURIComponent(id)}/stream`, { signal });
  if (!response.ok || response.body === null) throw new Error(`${response.status} could not follow the process`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const dispatch = (block: string): void => {
    const event = /^event: (\w+)$/m.exec(block)?.[1];
    const data = /^data: (.*)$/m.exec(block)?.[1];
    if (event === undefined || data === undefined) return;
    const payload: unknown = JSON.parse(data);
    if (event === "line") {
      const line = Schema.decodeUnknownSync(streamLine)(payload);
      onEvent({ kind: "line", text: line.text, stderr: line.stream === "stderr" });
    } else if (event === "exit") {
      onEvent({ kind: "exit", exitCode: Schema.decodeUnknownSync(streamExit)(payload).exitCode });
    }
  };
  const pump = async (buffer: string): Promise<void> => {
    const { done, value } = await reader.read();
    if (done) return;
    const blocks = (buffer + decoder.decode(value, { stream: true })).split("\n\n");
    blocks.slice(0, -1).forEach(dispatch);
    return pump(blocks.at(-1) ?? "");
  };
  return pump("");
};
