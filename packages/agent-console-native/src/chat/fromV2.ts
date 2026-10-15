/**
 * The chat's view (model.ts) of opencode v2 session messages. Cached per
 * message object: the event projection (core/message-updater.ts, immer) makes
 * a new object only for the message an event touched, so every other message
 * keeps its view, and its memoized bubble does not re-render.
 *
 * What the chat shows: what the user sent, what the agent wrote (text,
 * reasoning, tool calls) and shell runs. The rest of v2's history (the model,
 * agent or location switching, system and synthetic context, skills loaded,
 * compaction summaries, the session going idle) is the server's own
 * bookkeeping and is left out.
 *
 * @internal
 */
import { DateTime } from "effect";
import type { SessionMessage } from "../opencode/schema/session-message";
import type { ChatMessage, ChatPart, ChatTool } from "./model";

const views = new WeakMap<SessionMessage.Info, ChatMessage>();

const ms = (time: DateTime.Utc): number => DateTime.toEpochMillis(time);

const textOfContent = (content: ReadonlyArray<{ readonly type: string; readonly text?: string }>): string =>
  content
    .flatMap((item) => (item.type === "text" && item.text !== undefined ? [item.text] : []))
    .join("\n");

const toolOf = (tool: SessionMessage.AssistantTool): ChatTool => {
  const base = { kind: "tool", id: tool.id, name: tool.name } satisfies Partial<ChatTool>;
  switch (tool.state.status) {
    // Its input still arriving (a string, not yet parsed): shown as waiting.
    case "streaming":
      return { ...base, status: "pending", input: {} };
    case "running":
      return { ...base, status: "running", input: tool.state.input, metadata: tool.state.metadata };
    case "completed":
      return { ...base, status: "completed", input: tool.state.input, output: textOfContent(tool.state.content), metadata: tool.state.metadata };
    case "error":
      return { ...base, status: "error", input: tool.state.input, error: tool.state.error.message, metadata: tool.state.metadata };
  }
};

/** A part's view; text and reasoning have no id in v2, so their place in the
 * message names them (parts are only ever added at the end). */
const partOf = (messageID: string, content: SessionMessage.AssistantContent, index: number): ChatPart => {
  switch (content.type) {
    case "text":
      return { kind: "text", id: `${messageID}:${index}`, text: content.text };
    case "reasoning":
      return {
        kind: "reasoning",
        id: `${messageID}:${index}`,
        text: content.text,
        time: content.time === undefined ? undefined : { start: ms(content.time.created), end: content.time.completed === undefined ? undefined : ms(content.time.completed) },
      };
    case "tool":
      return toolOf(content);
  }
};

const viewOf = (message: SessionMessage.Info): ChatMessage | undefined => {
  switch (message.type) {
    case "user": {
      // A skill mentioned at the very start is its `/name` (the composer's chip).
      const lead = message.skills?.find((skill) => skill.mention?.start === 0);
      const end = lead?.mention?.end ?? 0;
      return {
        id: message.id,
        role: "user",
        parts: [{ kind: "text", id: `${message.id}:text`, text: lead === undefined ? message.text : message.text.slice(end).trim() }],
        time: { created: ms(message.time.created) },
        ...(lead === undefined ? {} : { slash: { name: lead.id, source: "skill" } }),
      };
    }
    case "assistant":
      return {
        id: message.id,
        role: "assistant",
        parts: message.content.map((content, index) => partOf(message.id, content, index)),
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
            id: message.shellID,
            name: "shell",
            status: message.time.completed === undefined ? "running" : "completed",
            input: { command: message.command },
            output: message.output?.output,
          },
        ],
        time: { created: ms(message.time.created), completed: message.time.completed === undefined ? undefined : ms(message.time.completed) },
      };
    case "agent-switched":
    case "model-switched":
    case "location-switched":
    case "synthetic":
    case "system":
    case "skill":
    case "compaction":
      return undefined;
    case "idle":
      // A turn that failed says why; one that ended well or was stopped
      // shows nothing of its own.
      return message.outcome !== "failed"
        ? undefined
        : {
            id: message.id,
            role: "assistant",
            parts: [{ kind: "error", id: `${message.id}:error`, text: message.error?.message ?? "The agent could not answer." }],
            time: { created: ms(message.time.created), completed: ms(message.time.created) },
          };
  }
};

/** The chat's messages, in order, from v2's. */
export const chatMessagesOfV2 = (messages: ReadonlyArray<SessionMessage.Info>): ReadonlyArray<ChatMessage> =>
  messages.flatMap((message) => {
    const known = views.get(message);
    if (known !== undefined) return [known];
    const view = viewOf(message);
    if (view === undefined) return [];
    views.set(message, view);
    return [view];
  });
