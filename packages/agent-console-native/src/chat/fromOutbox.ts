/**
 * The chat's view (model.ts) of messages still in the outbox: shown after the
 * conversation, untinted (`queued`), until the server has them (then the
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
