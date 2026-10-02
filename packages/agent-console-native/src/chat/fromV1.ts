/**
 * The chat's view (model.ts) of a v1 transcript message (useSessionStream).
 * Cached per message object: the stream makes a new object only for the
 * message an event touched, so every other message keeps its view, and its
 * memoized bubble does not re-render.
 *
 * @internal
 */
import type { ToolPart } from "@opencode-ai/sdk";
import { Predicate } from "effect";
import { EMPTY, type RenderablePart, type TranscriptMessage, withPart, withRole } from "../useSessionStream";
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
    // Without opencode's synthetic text: what it adds for the agent (an
    // attached file's contents, the read that fetched them), not what was
    // written. Its own interface hides them too.
    parts: Array.from(message.parts.values()).filter((part) => !(part.type === "text" && part.synthetic === true)).map(partOf),
    model: message.providerID !== undefined && message.modelID !== undefined ? { providerID: message.providerID, modelID: message.modelID } : undefined,
    time: message.time,
  };
  views.set(message, view);
  return view;
};

/** A v1 history entry, as read (its parts not yet looked at). */
export interface V1HistoryEntry {
  readonly info: {
    readonly id: string;
    readonly role: "user" | "assistant";
    readonly providerID?: string;
    readonly modelID?: string;
    readonly time: { readonly created: number; readonly completed?: number };
  };
  readonly parts: ReadonlyArray<unknown>;
}

/** Whether a stored or fetched part is one the chat shows: text, reasoning
 * or a tool call, with what each needs. */
const isRenderable = (part: unknown): part is RenderablePart =>
  Predicate.hasProperty(part, "id") &&
  Predicate.isString(part.id) &&
  Predicate.hasProperty(part, "messageID") &&
  Predicate.isString(part.messageID) &&
  Predicate.hasProperty(part, "type") &&
  (((part.type === "text" || part.type === "reasoning") && Predicate.hasProperty(part, "text") && Predicate.isString(part.text)) ||
    (part.type === "tool" &&
      Predicate.hasProperty(part, "tool") &&
      Predicate.isString(part.tool) &&
      Predicate.hasProperty(part, "state") &&
      Predicate.hasProperty(part.state, "status") &&
      Predicate.isString(part.state.status)));

/** The chat's view of a v1 history page, oldest first. */
export const chatMessagesOfV1History = (history: ReadonlyArray<V1HistoryEntry>): ReadonlyArray<ChatMessage> => {
  let transcript = EMPTY;
  for (const { info, parts } of history) {
    const model = info.providerID !== undefined && info.modelID !== undefined ? { providerID: info.providerID, modelID: info.modelID } : undefined;
    transcript = withRole(transcript, info.id, info.role, model, info.time);
    for (const part of parts) if (isRenderable(part)) transcript = withPart(transcript, part);
  }
  return transcript.order.flatMap((id) => {
    const message = transcript.messages.get(id);
    return message === undefined ? [] : [chatMessageOfV1(message)];
  });
};
