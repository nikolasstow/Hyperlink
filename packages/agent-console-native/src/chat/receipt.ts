/**
 * Read receipts, as iOS Messages shows them: one line under your latest
 * message saying how far it got. Sending… while it waits in the outbox, Not
 * Delivered when the server refused it (the lane is held on it), Delivered
 * with the time once the server has it, Read with the time once the agent answered it (its
 * first answer after it began).
 *
 * @internal
 */
import { type ChatMessage, epochMs } from "./model";
import { clockTime, daysBetween } from "./time";

export type Receipt =
  | { readonly kind: "sending" }
  | { readonly kind: "notDelivered" }
  | { readonly kind: "delivered"; readonly at: number | undefined }
  | { readonly kind: "read"; readonly at: number };

/** The receipt for your latest message, and which message that is. */
export interface LatestReceipt {
  readonly messageID: string;
  readonly receipt: Receipt;
}

export const latestReceipt = (messages: ReadonlyArray<ChatMessage>, heldID: string | undefined): LatestReceipt | undefined => {
  const index = messages.findLastIndex((message) => message.role === "user");
  const mine = messages[index];
  if (mine === undefined) return undefined;
  if (mine.queued === true) return { messageID: mine.id, receipt: mine.id === heldID ? { kind: "notDelivered" } : { kind: "sending" } };
  const answer = messages.slice(index + 1).find((message) => message.role === "assistant" && message.time !== undefined);
  return {
    messageID: mine.id,
    receipt:
      answer?.time === undefined
        ? { kind: "delivered", at: mine.time === undefined ? undefined : epochMs(mine.time.created) }
        : { kind: "read", at: epochMs(answer.time.created) },
  };
};

/** When it was delivered or read, as Messages says it: the time today, Yesterday, the
 * weekday within the week, else the date. */
export const receiptTimeLabel = (at: number, now: number): string => {
  const days = daysBetween(at, now);
  if (days <= 0) return clockTime(at);
  if (days === 1) return "Yesterday";
  if (days < 7) return new Date(at).toLocaleDateString([], { weekday: "long" });
  return new Date(at).toLocaleDateString([], { month: "numeric", day: "numeric", year: "2-digit" });
};
