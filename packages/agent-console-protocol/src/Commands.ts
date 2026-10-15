/**
 * What `/` offers in a composer: the commands and skills opencode has in a
 * folder, as `GET /commands?directory=…` sends them (a JSON array).
 *
 * Only what a row needs travels: a skill's text stays on the server.
 *
 * @since 0.0.1
 */
import { Schema } from "effect";

/** Where the list is served. */
export const path = "/commands";

/** Where an entry comes from: a command runs on its own
 * (`session.command`); a skill goes with a message. */
export const Source = Schema.Literals(["command", "skill"]);
export type Source = typeof Source.Type;

/** One entry, as a row shows it. */
export const Entry = Schema.Struct({
  /** Stable and source-prefixed: `command:<name>`, `skill:<id>`. */
  id: Schema.String,
  /** What follows the `/`. */
  name: Schema.String,
  description: Schema.optionalKey(Schema.String),
  source: Source,
  /** A skill's file on the server (absolute), to open and edit it. Absent
   * for a command, and for a skill built into opencode (it has no file). */
  path: Schema.optionalKey(Schema.String),
});
export type Entry = typeof Entry.Type;

/** A folder's entries, sorted by name. */
export const List = Schema.Array(Entry);
