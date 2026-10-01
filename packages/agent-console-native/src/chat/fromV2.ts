/**
 * The chat's view (model.ts) of opencode v2 session messages. Cached per
 * message object: the event projection (core/message-updater.ts, immer) makes
 * a new object only for the message an event touched, so every other message
 * keeps its view, and its memoized bubble does not re-render.
 *
 * What the chat shows: what the user sent, what the agent wrote (text,
 * reasoning, tool calls) and shell runs. The rest of v2's history (the model
 * or agent switching, system and synthetic context, compaction summaries) is
 * the server's own bookkeeping and is left out.
 *
 * @internal
 */
import { DateTime } from "effect";
import type { SessionMessage } from "../opencode/schema/session-message";
import type { ChatMessage, ChatPart, ChatTool } from "./model";

const views = new WeakMap<SessionMessage.Message, ChatMessage>();

const ms = (time: DateTime.Utc): number => DateTime.toEpochMillis(time);

const textOfContent = (content: ReadonlyArray<{ readonly type: string; readonly text?: string }>): string =>
  content
    .flatMap((item) => (item.type === "text" && item.text !== undefined ? [item.text] : []))
    .join("\n");

const toolOf = (tool: SessionMessage.AssistantTool): ChatTool => {
  const base = { kind: "tool", id: tool.id, name: tool.name } satisfies Partial<ChatTool>;
  switch (tool.state.status) {
    case "pending":
      return { ...base, status: "pending", input: {} };
    case "running":
      return { ...base, status: "running", input: tool.state.input, metadata: tool.state.structured };
    case "completed":
      return { ...base, status: "completed", input: tool.state.input, output: textOfContent(tool.state.content), metadata: tool.state.structured };
    case "error":
      return { ...base, status: "error", input: tool.state.input, error: tool.state.error.message, metadata: tool.state.structured };
  }
};

const partOf = (content: SessionMessage.AssistantContent): ChatPart => {
  switch (content.type) {
    case "text":
      return { kind: "text", id: content.id, text: content.text };
    case "reasoning":
      return {
        kind: "reasoning",
        id: content.id,
        text: content.text,
        time: content.time === undefined ? undefined : { start: ms(content.time.created), end: content.time.completed === undefined ? undefined : ms(content.time.completed) },
      };
    case "tool":
      return toolOf(content);
  }
};

const viewOf = (message: SessionMessage.Message): ChatMessage | undefined => {
  switch (message.type) {
    case "user":
      return { id: message.id, role: "user", parts: [{ kind: "text", id: `${message.id}:text`, text: message.text }], time: { created: ms(message.time.created) } };
    case "assistant":
      return {
        id: message.id,
        role: "assistant",
        parts: message.content.map(partOf),
        model: { providerID: message.model.providerID, modelID: message.model.id },
        time: { created: ms(message.time.created), completed: message.time.completed === undefined ? undefined : ms(message.time.completed) },
      };
    case "shell":
      return {
        id: message.id,
        role: "assistant",
        parts: [
          {
            kind: "tool",
            id: message.callID,
            name: "shell",
            status: message.time.completed === undefined ? "running" : "completed",
            input: { command: message.command },
            output: message.output,
          },
        ],
        time: { created: ms(message.time.created), completed: message.time.completed === undefined ? undefined : ms(message.time.completed) },
      };
    case "agent-switched":
    case "model-switched":
    case "synthetic":
    case "system":
    case "compaction":
      return undefined;
  }
};

/** The chat's messages, in order, from v2's. */
export const chatMessagesOfV2 = (messages: ReadonlyArray<SessionMessage.Message>): ReadonlyArray<ChatMessage> =>
  messages.flatMap((message) => {
    const known = views.get(message);
    if (known !== undefined) return [known];
    const view = viewOf(message);
    if (view === undefined) return [];
    views.set(message, view);
    return [view];
  });
