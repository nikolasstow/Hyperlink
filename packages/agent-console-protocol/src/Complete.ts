/**
 * Inline suggestions (docs/handoffs/code-intelligence.md): what to insert at
 * the caret, from a model, as `POST /complete` answers it. The app sends the
 * text around the caret as you see it (unsaved edits included).
 *
 * @since 0.0.1
 */
import { Schema } from "effect";

/** Where suggestions are served. */
export const path = "/complete";

export const Request = Schema.Struct({
  /** The file, for its name and language. */
  path: Schema.String,
  /** The text before the caret (its end, as much as is sent). */
  prefix: Schema.String,
  /** The text after the caret (its start). */
  suffix: Schema.String,
  /** The model to ask; the server's default without one. */
  model: Schema.optionalKey(Schema.Struct({ providerID: Schema.String, id: Schema.String })),
});
export type Request = typeof Request.Type;

/** What to insert at the caret; empty when there is nothing to suggest. */
export const Response = Schema.Struct({
  text: Schema.String,
});
export type Response = typeof Response.Type;
