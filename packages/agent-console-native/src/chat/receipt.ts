/**
 * Read receipts, as iOS Messages shows them: one line under your latest
 * message saying how far it got. Sending… while it waits in the outbox, Not
 * Delivered when the server refused it (the lane is held on it), Delivered
 * once the server has it, Read with the time once the agent answered it (its
 * first answer after it began).
 *
 * @internal
 */
import type { ChatMessage } from "./model";

export type Receipt =
  | { readonly kind: "sending" }
  | { readonly kind: "notDelivered" }
  | { readonly kind: "delivered" }
  | { readonly kind: "read"; readonly at: number };

/** The receipt for your latest message, and which message that is. */
export interface LatestReceipt {
  readonly messageID: string;
  readonly receipt: Receipt;
}

/** Epoch ms (opencode has reported seconds in places). */
const epochMs = (time: number): number => (time < 1e12 ? time * 1000 : time);

export const latestReceipt = (messages: ReadonlyArray<ChatMessage>, heldID: string | undefined): LatestReceipt | undefined => {
  const index = messages.findLastIndex((message) => message.role === "user");
  const mine = messages[index];
  if (mine === undefined) return undefined;
  if (mine.queued === true) return { messageID: mine.id, receipt: mine.id === heldID ? { kind: "notDelivered" } : { kind: "sending" } };
  const answer = messages.slice(index + 1).find((message) => message.role === "assistant" && message.time !== undefined);
  return {
    messageID: mine.id,
    receipt: answer?.time === undefined ? { kind: "delivered" } : { kind: "read", at: epochMs(answer.time.created) },
  };
};

const startOfDay = (time: number): number => {
  const day = new Date(time);
  day.setHours(0, 0, 0, 0);
  return day.getTime();
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** When it was read, as Messages says it: the time today, Yesterday, the
 * weekday within the week, else the date. */
export const readTimeLabel = (at: number, now: number): string => {
  const days = Math.round((startOfDay(now) - startOfDay(at)) / DAY_MS);
  if (days <= 0) return new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (days === 1) return "Yesterday";
  if (days < 7) return new Date(at).toLocaleDateString([], { weekday: "long" });
  return new Date(at).toLocaleDateString([], { month: "numeric", day: "numeric", year: "2-digit" });
};
