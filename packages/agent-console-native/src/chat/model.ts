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

/** Epoch ms: opencode has reported seconds in places, and a value small
 * enough to be seconds would put a clock decades out. */
export const epochMs = (time: number): number => (time < 1e12 ? time * 1000 : time);

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

/** When the answer being written started (epoch ms), for the elapsed clock;
 * undefined when none is. */
export const answerStartedAt = (messages: ReadonlyArray<ChatMessage>): number | undefined => {
  const last = messages.findLast((message) => message.role === "assistant");
  if (last?.time === undefined || last.time.completed !== undefined) return undefined;
  return epochMs(last.time.created);
};

/** Longer than two lines of a card can show; the card cuts it to two. */
const SUMMARY_MAX = 160;

/** A conversation's last written words, for a card: whose, and the text on
 * one line (shortened). Undefined when nothing has been written. */
export const lastSummary = (messages: ReadonlyArray<ChatMessage>): { readonly role: "user" | "assistant"; readonly text: string } | undefined => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message === undefined) continue;
    const text = textOf(message).trim().replace(/\s+/g, " ");
    if (text !== "") return { role: message.role, text: text.length > SUMMARY_MAX ? `${text.slice(0, SUMMARY_MAX - 1)}…` : text };
  }
  return undefined;
};
