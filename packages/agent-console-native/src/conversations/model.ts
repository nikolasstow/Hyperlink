/**
 * What the device keeps of a conversation: the newest of its messages (the
 * chat's own view, chat/model.ts), its title, which API it is spoken over,
 * and when the server last changed it as of keeping them. Schema, so it is stored and read
 * back as JSON (`Schema.toCodecJson`), checked.
 *
 * @internal
 */
import { Schema } from "effect";

const Text = Schema.Struct({
  kind: Schema.Literal("text"),
  id: Schema.String,
  text: Schema.String,
});

const Reasoning = Schema.Struct({
  kind: Schema.Literal("reasoning"),
  id: Schema.String,
  text: Schema.String,
  time: Schema.optional(
    Schema.Struct({
      start: Schema.Number,
      end: Schema.optional(Schema.Number),
    }),
  ),
});

const Tool = Schema.Struct({
  kind: Schema.Literal("tool"),
  id: Schema.String,
  name: Schema.String,
  status: Schema.Literals(["pending", "running", "completed", "error"]),
  input: Schema.Record(Schema.String, Schema.Unknown),
  output: Schema.optional(Schema.String),
  error: Schema.optional(Schema.String),
  metadata: Schema.optional(Schema.Unknown),
});

const Message = Schema.Struct({
  id: Schema.String,
  role: Schema.Literals(["user", "assistant"]),
  parts: Schema.Array(Schema.Union([Text, Reasoning, Tool])),
  model: Schema.optional(
    Schema.Struct({
      providerID: Schema.String,
      modelID: Schema.String,
    }),
  ),
  time: Schema.optional(
    Schema.Struct({
      created: Schema.Number,
      completed: Schema.optional(Schema.Number),
    }),
  ),
  queued: Schema.optional(Schema.Boolean),
});

export const Conversation = Schema.Struct({
  protocol: Schema.Literals(["v1", "v2"]),
  /** When the server last changed the session, as of these messages (ms). */
  updated: Schema.Number,
  /** Its title, for the chat's header from the first frame. */
  title: Schema.optional(Schema.String),
  /** The newest messages, oldest first. */
  messages: Schema.Array(Message),
});
export type Conversation = typeof Conversation.Type;

/** The keys of the conversations kept (to read them back at launch). */
export const ConversationKeys = Schema.Array(Schema.String);

/** One conversation's key: its server and session. */
export const conversationKey = (server: string, sessionID: string): string => `${server}|${sessionID}`;
