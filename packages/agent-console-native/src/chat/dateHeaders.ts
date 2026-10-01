/**
 * The dates between bubbles, as iOS Messages shows them: over a message that
 * starts a new day, or comes an hour or more after the one before it (and over
 * the first), its day in bold and its time.
 *
 * @internal
 */
import { type ChatMessage, epochMs } from "./model";
import { clockTime, daysBetween } from "./time";

/** A quiet spell this long starts a new header. */
export const HEADER_GAP_MS = 60 * 60 * 1000;

/** The messages that get a header, and the time each shows (epoch ms). */
export const dateHeaders = (messages: ReadonlyArray<ChatMessage>): ReadonlyMap<string, number> => {
  const headers = new Map<string, number>();
  let previous: number | undefined;
  for (const message of messages) {
    if (message.time === undefined) continue;
    const at = epochMs(message.time.created);
    if (previous === undefined || at - previous >= HEADER_GAP_MS || daysBetween(previous, at) !== 0) headers.set(message.id, at);
    previous = at;
  }
  return headers;
};

export interface DateHeaderLabel {
  /** Bold: Today, Yesterday, the weekday, or the date. */
  readonly day: string;
  /** "6:51 PM". */
  readonly time: string;
}

/** Messages' own wording: Today, Yesterday, the weekday within the week, the
 * short date within the year, else with the year. */
export const dateHeaderLabel = (at: number, now: number): DateHeaderLabel => {
  const days = daysBetween(at, now);
  const date = new Date(at);
  const day =
    days <= 0
      ? "Today"
      : days === 1
        ? "Yesterday"
        : days < 7
          ? date.toLocaleDateString([], { weekday: "long" })
          : date.getFullYear() === new Date(now).getFullYear()
            ? date.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })
            : date.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
  return { day, time: clockTime(at) };
};
