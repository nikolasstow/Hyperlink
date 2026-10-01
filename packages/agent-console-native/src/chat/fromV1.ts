/**
 * The chat's view (model.ts) of a v1 transcript message (useSessionStream).
 * Cached per message object: the stream makes a new object only for the
 * message an event touched, so every other message keeps its view, and its
 * memoized bubble does not re-render.
 *
 * @internal
 */
import type { ToolPart } from "@opencode-ai/sdk";
import type { RenderablePart, TranscriptMessage } from "../useSessionStream";
import type { ChatMessage, ChatPart, ChatTool } from "./model";

const views = new WeakMap<TranscriptMessage, ChatMessage>();

const toolOf = (part: ToolPart): ChatTool => {
  const base = { kind: "tool", id: part.id, name: part.tool } satisfies Partial<ChatTool>;
  switch (part.state.status) {
    case "pending":
      return { ...base, status: "pending", input: part.state.input };
    case "running":
      return { ...base, status: "running", input: part.state.input, metadata: part.state.metadata };
    case "completed":
      return { ...base, status: "completed", input: part.state.input, output: part.state.output, metadata: part.state.metadata };
    case "error":
      return { ...base, status: "error", input: part.state.input, error: part.state.error, metadata: part.state.metadata };
  }
};

const partOf = (part: RenderablePart): ChatPart => {
  switch (part.type) {
    case "text":
      return { kind: "text", id: part.id, text: part.text };
    case "reasoning":
      return { kind: "reasoning", id: part.id, text: part.text, time: part.time };
    case "tool":
      return toolOf(part);
  }
};

export const chatMessageOfV1 = (message: TranscriptMessage): ChatMessage => {
  const known = views.get(message);
  if (known !== undefined) return known;
  const view: ChatMessage = {
    id: message.id,
    role: message.role,
    parts: Array.from(message.parts.values(), partOf),
    model: message.providerID !== undefined && message.modelID !== undefined ? { providerID: message.providerID, modelID: message.modelID } : undefined,
    time: message.time,
  };
  views.set(message, view);
  return view;
};
