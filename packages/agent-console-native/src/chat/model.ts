/**
 * The chat's view of a conversation, whatever protocol it came over: the
 * bubbles render this, and adapters make it from opencode's v1 transcript
 * (fromV1.ts) and its v2 messages (fromV2.ts). Times are epoch ms.
 *
 * @internal
 */

export interface ChatText {
  readonly kind: "text";
  readonly id: string;
  readonly text: string;
}

export interface ChatReasoning {
  readonly kind: "reasoning";
  readonly id: string;
  readonly text: string;
  readonly time?: { readonly start: number; readonly end?: number };
}

export interface ChatTool {
  readonly kind: "tool";
  readonly id: string;
  readonly name: string;
  readonly status: "pending" | "running" | "completed" | "error";
  readonly input: Readonly<Record<string, unknown>>;
  /** Its output as text, once completed. */
  readonly output?: string;
  /** What went wrong, once failed. */
  readonly error?: string;
  /** What the tool reported besides its output (an HTML page, for one). */
  readonly metadata?: unknown;
}

export type ChatPart = ChatText | ChatReasoning | ChatTool;

export interface ChatMessage {
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly parts: ReadonlyArray<ChatPart>;
  /** The model that answered (assistant). */
  readonly model?: { readonly providerID: string; readonly modelID: string };
  /** `completed` is absent while an answer is still being written. */
  readonly time?: { readonly created: number; readonly completed?: number };
  /** Still in the outbox (not yet on the server). */
  readonly queued?: boolean;
}

/** A message's text parts, joined. */
export const textOf = (message: ChatMessage): string =>
  message.parts
    .filter((part): part is ChatText => part.kind === "text")
    .map((part) => part.text)
    .join("\n\n");

/** Whether the newest answer is still being written. */
export const answering = (messages: ReadonlyArray<ChatMessage>): boolean => {
  const last = messages.findLast((message) => message.role === "assistant");
  return last !== undefined && last.time !== undefined && last.time.completed === undefined;
};
