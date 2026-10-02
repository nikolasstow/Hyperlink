/**
 * The chat's view (model.ts) of messages still in the outbox: shown after the
 * conversation (`queued`), until the server has them (then the
 * conversation has them, under the same id, and these step aside). Cached per
 * queued message, so its bubble keeps its identity while it waits.
 *
 * @internal
 */
import type { QueuedMessage } from "../outbox/model";
import type { ChatMessage } from "./model";

const views = new WeakMap<QueuedMessage, ChatMessage>();

export const chatMessageOfQueued = (message: QueuedMessage): ChatMessage => {
  const known = views.get(message);
  if (known !== undefined) return known;
  const view: ChatMessage = {
    id: message.id,
    role: "user",
    parts: [{ kind: "text", id: `${message.id}:text`, text: message.text }],
    time: { created: message.queuedAt },
    queued: true,
  };
  views.set(message, view);
  return view;
};

const sentViews = new WeakMap<ChatMessage, ChatMessage>();

/** A queued message the server took: no longer `queued`. Cached, so it keeps
 * its identity. */
const sentView = (queued: ChatMessage): ChatMessage => {
  const known = sentViews.get(queued);
  if (known !== undefined) return known;
  const view: ChatMessage = { ...queued, queued: false };
  sentViews.set(queued, view);
  return view;
};

/**
 * The messages to show after the conversation: those still queued, and those
 * the server has taken that the conversation does not show yet. The outbox
 * lets go of a message as the server takes it, a moment before the
 * conversation brings it back; without carrying it over that moment, its
 * bubble would leave and come back new (and its arrival would stop dead).
 * `shown` is what this returned last time.
 */
export const pendingMessages = (
  shown: ReadonlyArray<ChatMessage>,
  queued: ReadonlyArray<ChatMessage>,
  conversation: ReadonlySet<string>,
): ReadonlyArray<ChatMessage> => {
  const queuedIDs = new Set(queued.map((message) => message.id));
  const sent = shown
    .filter((message) => !queuedIDs.has(message.id) && !conversation.has(message.id))
    .map((message) => (message.queued === true ? sentView(message) : message));
  return [...sent, ...queued.filter((message) => !conversation.has(message.id))];
};

/** Whether two lists hold the same message objects, in order. */
export const sameMessages = (a: ReadonlyArray<ChatMessage>, b: ReadonlyArray<ChatMessage>): boolean =>
  a.length === b.length && a.every((message, index) => message === b[index]);
