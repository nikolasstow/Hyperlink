/**
 * A session's messages in memory, built from its events as the server builds
 * them: durable events through opencode's own message updater
 * (core/message-updater.ts) over an adapter on this list; the ephemeral ones
 * (text and reasoning as they are written, a tool's input as it streams, a
 * tool's progress) applied as opencode's own client applies them.
 *
 * A message an event changes is replaced (the updater works on an immer
 * draft); every other keeps its object, so a view cached per message
 * (fromV2.ts) is reused.
 *
 * @internal
 */
import { Effect } from "effect";
import { produce } from "immer";
import { type Adapter, update } from "../opencode/core/message-updater";
import type { SessionEvent } from "../opencode/schema/session-event";
import type { SessionMessage } from "../opencode/schema/session-message";

/** The list the projection keeps (replaced, never changed in place). */
export interface Projection {
  messages: ReadonlyArray<SessionMessage.Info>;
}

const replace = (projection: Projection, next: SessionMessage.Info): void => {
  const at = projection.messages.findIndex((message) => message.id === next.id);
  projection.messages = at === -1 ? [...projection.messages, next] : projection.messages.map((message, index) => (index === at ? next : message));
};

const lastOf = <T extends SessionMessage.Info["type"]>(projection: Projection, type: T) =>
  projection.messages.findLast((message): message is Extract<SessionMessage.Info, { readonly type: T }> => message.type === type);

/** The updater's view of this list. */
const adapterOf = (projection: Projection): Adapter => ({
  getAgent: () => Effect.sync(() => lastOf(projection, "agent-switched")?.agent),
  getModel: () => Effect.sync(() => lastOf(projection, "model-switched")?.model),
  getLocation: () =>
    Effect.sync(() => {
      const moved = lastOf(projection, "location-switched");
      return moved === undefined ? undefined : { location: moved.location, projectID: moved.projectID, subpath: moved.subpath };
    }),
  getCurrentAssistant: () =>
    Effect.sync(() => {
      const assistant = lastOf(projection, "assistant");
      return assistant !== undefined && assistant.time.completed === undefined ? assistant : undefined;
    }),
  getAssistant: (messageID) =>
    Effect.sync(() => projection.messages.find((message): message is SessionMessage.Assistant => message.type === "assistant" && message.id === messageID)),
  getShell: (shellID) =>
    Effect.sync(() => projection.messages.findLast((message): message is SessionMessage.Shell => message.type === "shell" && message.shellID === shellID)),
  getCompaction: () =>
    Effect.sync(() => projection.messages.findLast((message): message is SessionMessage.Compaction => message.type === "compaction" && message.status === "running")),
  updateAssistant: (assistant) => Effect.sync(() => replace(projection, assistant)),
  updateShell: (shell) => Effect.sync(() => replace(projection, shell)),
  updateCompaction: (compaction) => Effect.sync(() => replace(projection, compaction)),
  appendMessage: (message) =>
    Effect.sync(() => {
      if (!projection.messages.some((known) => known.id === message.id)) projection.messages = [...projection.messages, message];
    }),
});

/** Applies a durable event: what the server does with it. */
export const applyDurable = (projection: Projection, event: SessionEvent.DurableEvent): Effect.Effect<void> => update(adapterOf(projection), event);

/** The ephemeral events the chat shows as they come. */
export type Streaming = Extract<
  SessionEvent.Event,
  { readonly type: "session.text.delta" | "session.reasoning.delta" | "session.tool.input.delta" | "session.tool.progress" }
>;

const STREAMING: ReadonlySet<string> = new Set(["session.text.delta", "session.reasoning.delta", "session.tool.input.delta", "session.tool.progress"]);

export const isStreaming = (event: SessionEvent.Event): event is Streaming => STREAMING.has(event.type);

/** Applies an ephemeral event to its assistant message, as opencode's client does. */
export const applyStreaming = (projection: Projection, event: Streaming): void => {
  const at = projection.messages.findIndex((message) => message.type === "assistant" && message.id === event.data.assistantMessageID);
  const target = projection.messages[at];
  if (target?.type !== "assistant") return;
  const next = produce(target, (assistant) => {
    switch (event.type) {
      case "session.text.delta": {
        const text = assistant.content.findLast((item) => item.type === "text");
        if (text?.type === "text") text.text += event.data.delta;
        return;
      }
      case "session.reasoning.delta": {
        const reasoning = assistant.content.findLast((item) => item.type === "reasoning" && item.time?.completed === undefined);
        if (reasoning?.type === "reasoning") reasoning.text += event.data.delta;
        return;
      }
      case "session.tool.input.delta": {
        const tool = assistant.content.findLast((item) => item.type === "tool" && item.id === event.data.id);
        if (tool?.type === "tool" && tool.state.status === "streaming") tool.state.input += event.data.delta;
        return;
      }
      case "session.tool.progress": {
        const tool = assistant.content.findLast((item) => item.type === "tool" && item.id === event.data.id);
        if (tool?.type === "tool" && tool.state.status === "running") tool.state.metadata = event.data.metadata;
        return;
      }
    }
  });
  projection.messages = projection.messages.map((message, index) => (index === at ? next : message));
};
