/**
 * The file-sync protocol between the file hub (the agent-console API server)
 * and the apps editing files.
 *
 * The hub owns each followed file's version and puts every change in order.
 * A follower gets the file once (`Synced`), then each change after it
 * (`Changed`), whoever made it: an agent, another app, or anything else that
 * wrote the file. A write names the version it was made against; if the file
 * has moved on since, it is refused (`Stale`), and the writer rebases its
 * edits onto the changes it has been sent and writes again.
 *
 * @since 0.0.1
 */
import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/unstable/rpc";
import { TextChange } from "./TextChange";

/**
 * An agent session wrote the change (opencode's edit/write tools).
 *
 * @since 0.0.1
 */
export class Agent extends Schema.TaggedClass<Agent>()("Agent", {
  sessionID: Schema.String,
}) {}

/**
 * An app following the file wrote the change.
 *
 * @since 0.0.1
 */
export class Client extends Schema.TaggedClass<Client>()("Client", {
  clientID: Schema.String,
}) {}

/**
 * Something else wrote the file (another editor, git, a script).
 *
 * @since 0.0.1
 */
export class External extends Schema.TaggedClass<External>()("External", {}) {}

/**
 * Who made a change.
 *
 * @since 0.0.1
 */
export const author = Schema.Union([Agent, Client, External]);

/**
 * @since 0.0.1
 */
export type Author = Agent | Client | External;

/**
 * The file as the hub has it. First on every follow, and again whenever the
 * follower must start over (the hub restarted: a new `epoch`).
 *
 * @since 0.0.1
 */
export class Synced extends Schema.TaggedClass<Synced>()("Synced", {
  epoch: Schema.String,
  version: Schema.Int,
  text: Schema.String,
}) {}

/**
 * The file moved from `version - 1` to `version` by `changes`.
 *
 * @since 0.0.1
 */
export class Changed extends Schema.TaggedClass<Changed>()("Changed", {
  version: Schema.Int,
  changes: Schema.Array(TextChange),
  author,
}) {}

/**
 * The file is gone from disk (deleted or renamed away).
 *
 * @since 0.0.1
 */
export class Deleted extends Schema.TaggedClass<Deleted>()("Deleted", {
  version: Schema.Int,
}) {}

/**
 * What a follower is sent.
 *
 * @since 0.0.1
 */
export const fileEvent = Schema.Union([Synced, Changed, Deleted]);

/**
 * @since 0.0.1
 */
export type FileEvent = Synced | Changed | Deleted;

/**
 * Apply `changes` to `path`, made against `baseVersion`.
 *
 * @since 0.0.1
 */
export class WriteRequest extends Schema.Class<WriteRequest>("WriteRequest")({
  path: Schema.String,
  clientID: Schema.String,
  epoch: Schema.String,
  baseVersion: Schema.Int,
  changes: Schema.Array(TextChange),
}) {}

/**
 * The write is on disk as `version`.
 *
 * @since 0.0.1
 */
export class Accepted extends Schema.TaggedClass<Accepted>()("Accepted", {
  version: Schema.Int,
}) {}

/**
 * The file is at `version` (or a new epoch), not the write's base: rebase
 * on the changes the follow stream sends and write again.
 *
 * @since 0.0.1
 */
export class Stale extends Schema.TaggedClass<Stale>()("Stale", {
  version: Schema.Int,
}) {}

/**
 * @since 0.0.1
 */
export const writeResult = Schema.Union([Accepted, Stale]);

/**
 * @since 0.0.1
 */
export type WriteResult = Accepted | Stale;

/**
 * Why the hub can't follow or write a file.
 *
 * @since 0.0.1
 */
export class FileSyncError extends Schema.TaggedErrorClass<FileSyncError>()("FileSyncError", {
  reason: Schema.Literals(["NotFound", "NotAFile", "TooLarge", "InvalidChanges", "Io"]),
  path: Schema.String,
}) {}

/**
 * Follow a file: `Synced`, then every change.
 *
 * @since 0.0.1
 */
export class Follow extends Rpc.make("Follow", {
  payload: {
    path: Schema.String,
  },
  success: fileEvent,
  error: FileSyncError,
  stream: true,
}) {}

/**
 * Write changes to a file.
 *
 * @since 0.0.1
 */
export class Write extends Rpc.make("Write", {
  payload: WriteRequest,
  success: writeResult,
  error: FileSyncError,
}) {}

/**
 * The protocol.
 *
 * @since 0.0.1
 */
export class FileSyncRpcs extends RpcGroup.make(Follow, Write) {}

/**
 * Where the hub serves the protocol (a WebSocket, JSON-serialized).
 *
 * @since 0.0.1
 */
export const path = "/files/sync";
