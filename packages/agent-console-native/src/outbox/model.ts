/**
 * What the outbox holds, as schemas: it is persisted on the device and read
 * back on every launch, so everything in it decodes.
 *
 * A **lane** is one session on one server, in order: its messages are sent
 * one after another, never overtaking. A lane whose session does not exist
 * yet carries what creating it takes (its folder, made first if it is new),
 * dropped once the session is made.
 *
 * @internal
 */
import { Schema } from "effect";
import { ServerAddress } from "../opencode/serverAddress";
import { Agent } from "../opencode/schema/agent";
import { Model } from "../opencode/schema/model";
import { AbsolutePath } from "../opencode/schema/schema";
import { SessionID } from "../opencode/schema/session-id";
import { SessionMessage } from "../opencode/schema/session-message";

/** How a lane's messages reach the server: opencode's v2 session API, or v1
 * for a session made before the app moved to v2 (v2 cannot see its history,
 * so it is never prompted through v2). */
export const Protocol = Schema.Literals(["v2", "v1"]);
export type Protocol = typeof Protocol.Type;

/** A folder to make before the session, when the session is for a new one. */
export class NewFolder extends Schema.Class<NewFolder>("Outbox.NewFolder")({
  /** The folder it goes in (the workspace root, as typed: may start with `~`). */
  root: Schema.String,
  name: Schema.String,
}) {}

/** A session still to be made (in the lane's directory, under its id). */
export class NewSession extends Schema.Class<NewSession>("Outbox.NewSession")({
  /** Made first when set: the session is for a new folder. */
  folder: Schema.optional(NewFolder),
}) {}

/** A file sent with a message, by path. */
export class Attachment extends Schema.Class<Attachment>("Outbox.Attachment")({
  path: Schema.String,
  name: Schema.String,
}) {}

/** A message waiting to be sent. Its id is the one the server stores it
 * under: made when it is queued and the same on every attempt, so a retry is
 * recognised, never duplicated. */
export class QueuedMessage extends Schema.Class<QueuedMessage>("Outbox.QueuedMessage")({
  id: SessionMessage.ID,
  text: Schema.String,
  files: Schema.Array(Attachment),
  model: Schema.optional(Model.Ref),
  agent: Agent.ID,
  /** When it was queued (epoch ms). */
  queuedAt: Schema.Number,
}) {}

/** Why a lane has stopped: its first message cannot be sent as it is (the
 * server refused it), and nothing after it may overtake it. Retried or
 * removed by hand. */
export class Held extends Schema.Class<Held>("Outbox.Held")({
  messageID: SessionMessage.ID,
  reason: Schema.String,
  at: Schema.Number,
}) {}

/** One session on one server, its messages in order. */
export class Lane extends Schema.Class<Lane>("Outbox.Lane")({
  server: ServerAddress,
  sessionID: SessionID,
  protocol: Protocol,
  /** Where the session runs (absolute). Unknown only until a new folder is
   * made (the server resolves its root), then filled in. */
  directory: Schema.optional(AbsolutePath),
  /** Present until the session exists. */
  create: Schema.optional(NewSession),
  messages: Schema.Array(QueuedMessage),
  held: Schema.optional(Held),
}) {}

/** A lane's key: its server and session. */
export const LaneKey = Schema.String.pipe(Schema.brand("Outbox.LaneKey"));
export type LaneKey = typeof LaneKey.Type;
export const laneKey = (server: ServerAddress, sessionID: SessionID): LaneKey => LaneKey.make(`${server} ${sessionID}`);
export const keyOfLane = (lane: Lane): LaneKey => laneKey(lane.server, lane.sessionID);

/** Everything queued, as persisted. */
export const Lanes = Schema.Array(Lane);
