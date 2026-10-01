/**
 * The outbox: every message the user sends goes in here and is sent from
 * here, strictly in order per session, only when the server can take it.
 *
 * - **Lanes** (model.ts): one per session on a server, its messages in order.
 *   A message never overtakes an earlier one in its lane; lanes never wait on
 *   each other.
 * - **Workers**: one fiber per lane with work (a `FiberMap`), idle otherwise.
 *   A worker waits for the server (Reachability), makes the session if it is
 *   new (and its folder first, if that is new too: nothing is made before the
 *   send), switches the model (v2 keeps the model per session, in its ordered
 *   history), then admits the message under its own id with
 *   `delivery: "queue"`: from there opencode holds it until the agent is free,
 *   whatever the app is doing.
 * - **Failures** never jam it. One that may clear (no connection, no answer,
 *   a server error) is retried with backoff and the moment the server is back.
 *   One that will not (the server refused the message) holds that lane only,
 *   since nothing after it may overtake it, until it is retried or removed.
 *   Every step has a timeout.
 * - **Exactly once**: a message's id is made when it is queued and sent on
 *   every attempt; the server recognises a retry of the same id.
 * - **Persisted** on the device (debounced): the outbox survives the app being
 *   killed, and `drain` is what the background task runs.
 *
 * Sessions made before the app moved to v2 are v1 lanes: v2 cannot see their
 * history, so their messages go through v1 (`prompt_async`, same id rules).
 *
 * @internal
 */
import { Cause, Context, Data, Duration, Effect, FiberMap, HashMap, Layer, Option, Schedule, Schema, Stream, SubscriptionRef } from "effect";
import { HttpClient, HttpClientError, HttpClientRequest } from "effect/unstable/http";
import { KeyValueStore } from "effect/unstable/persistence";
import { Opencode, type OpencodeClient } from "../opencode/Opencode";
import type { ServerAddress } from "../opencode/serverAddress";
import { ServiceUnavailableError, UnknownError } from "../opencode/protocol/errors";
import type { Agent } from "../opencode/schema/agent";
import type { Model } from "../opencode/schema/model";
import { AbsolutePath } from "../opencode/schema/schema";
import type { SessionID } from "../opencode/schema/session-id";
import { SessionMessage } from "../opencode/schema/session-message";
import { Attachment, Held, keyOfLane, Lane, laneKey, type LaneKey, Lanes, NewFolder, NewSession, type Protocol, QueuedMessage } from "./model";
import { Folders } from "./Folders";
import { Reachability } from "./Reachability";

/** Each step's limit; past it, the attempt counts as no answer. */
const STEP_TIMEOUT = "20 seconds";
/** Retry backoff for failures that may clear: first wait, longest. */
const RETRY_FIRST = "1 second";
const RETRY_LONGEST = Duration.seconds(30);
/** Writes to the device are coalesced over this long. */
const PERSIST_DEBOUNCE = "150 millis";
const STORE_KEY = "lanes";

// ── Failures ────────────────────────────────────────────────────────────────

/** May clear by itself: no connection, no answer, a server error. Retried. */
class Transient extends Data.TaggedError("Outbox.Transient")<{ readonly cause: unknown; readonly unreachable: boolean }> {}

/** Will not clear by retrying: the server refused it. Holds the lane. */
class Refused extends Data.TaggedError("Outbox.Refused")<{ readonly reason: string }> {}

/** Sorts a step's failure: transport and timeouts are `unreachable`; 5xx and
 * opencode's unavailable/unknown errors may clear; anything else the server
 * said no to. */
const classify = (error: unknown): Transient | Refused => {
  if (Cause.isTimeoutError(error)) return new Transient({ cause: error, unreachable: true });
  // fetch's own failure to connect (outside HttpClient: the v1 shell calls).
  if (error instanceof TypeError) return new Transient({ cause: error, unreachable: true });
  if (HttpClientError.isHttpClientError(error)) {
    if (error.reason._tag === "TransportError") return new Transient({ cause: error, unreachable: true });
    if (error.reason._tag === "StatusCodeError" && error.reason.response.status >= 500) return new Transient({ cause: error, unreachable: false });
    return new Refused({ reason: error.message });
  }
  if (error instanceof ServiceUnavailableError || error instanceof UnknownError) return new Transient({ cause: error, unreachable: false });
  return new Refused({ reason: errorMessage(error) });
};

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

// ── v1 (sessions made before v2) ────────────────────────────────────────────

const V1Part = Schema.Union([
  Schema.Struct({ type: Schema.Literal("text"), text: Schema.String }),
  Schema.Struct({ type: Schema.Literal("file"), mime: Schema.String, url: Schema.String, filename: Schema.String }),
]);

const V1Prompt = Schema.Struct({
  messageID: Schema.String,
  agent: Schema.String,
  model: Schema.optional(Schema.Struct({ providerID: Schema.String, modelID: Schema.String })),
  parts: Schema.Array(V1Part),
});

// ── The service ─────────────────────────────────────────────────────────────

/** What sending a message takes. */
export interface Send {
  readonly server: ServerAddress;
  readonly sessionID: SessionID;
  readonly protocol: Protocol;
  /** Where the session runs; absent only for a new folder (made first). */
  readonly directory?: AbsolutePath;
  /** When the session does not exist yet: making it (and, when `folder` is
   * set, its new folder first). */
  readonly create?: { readonly folder?: { readonly root: string; readonly name: string } };
  readonly text: string;
  readonly files: ReadonlyArray<{ readonly path: string; readonly name: string }>;
  readonly model?: Model.Ref;
  readonly agent: Agent.ID;
}

type State = HashMap.HashMap<LaneKey, Lane>;

const retrySchedule = Schedule.exponential(RETRY_FIRST).pipe(
  Schedule.modifyDelay(({ duration }) => Effect.succeed(Duration.min(duration, RETRY_LONGEST))),
  Schedule.jittered,
);

const make = Effect.gen(function* () {
  const opencode = yield* Opencode;
  const reachability = yield* Reachability;
  const http = yield* HttpClient.HttpClient;
  const folders = yield* Folders;
  const store = KeyValueStore.toSchemaStore(yield* KeyValueStore.KeyValueStore, Lanes);

  // What was queued when the app last ran. A stored outbox that no longer
  // decodes is kept aside (never overwritten) and said, not dropped silently.
  const stored = yield* store.get(STORE_KEY).pipe(
    Effect.catch((error) =>
      Effect.logError("[outbox] the stored outbox could not be read; starting empty, keeping it aside", error).pipe(
        Effect.andThen(KeyValueStore.KeyValueStore.use((raw) => raw.get(STORE_KEY))),
        Effect.flatMap((value) => (value === undefined ? Effect.void : KeyValueStore.KeyValueStore.use((raw) => raw.set(`${STORE_KEY}.unreadable.${Date.now()}`, value)))),
        Effect.ignore,
        Effect.as(Option.none()),
      ),
    ),
  );
  const state = yield* SubscriptionRef.make<State>(
    HashMap.fromIterable(Option.getOrElse(stored, () => []).map((lane) => [keyOfLane(lane), lane])),
  );

  // Persist every change, coalesced.
  yield* SubscriptionRef.changes(state).pipe(
    Stream.debounce(PERSIST_DEBOUNCE),
    Stream.runForEach((lanes) =>
      store.set(STORE_KEY, Array.from(HashMap.values(lanes))).pipe(Effect.catch((error) => Effect.logError("[outbox] saving failed", error))),
    ),
    Effect.forkScoped,
  );

  const laneOf = (key: LaneKey) => SubscriptionRef.get(state).pipe(Effect.map((lanes) => HashMap.get(lanes, key)));
  const updateLane = (key: LaneKey, f: (lane: Lane) => Lane | undefined) =>
    SubscriptionRef.update(state, (lanes) =>
      Option.match(HashMap.get(lanes, key), {
        onNone: () => lanes,
        onSome: (lane) => {
          const next = f(lane);
          return next === undefined ? HashMap.remove(lanes, key) : HashMap.set(lanes, key, next);
        },
      }),
    );

  /** One step against the server: time-limited, its failure sorted, and the
   * server's reachability updated from how it went. */
  const step = <A, E, R>(server: ServerAddress, effect: Effect.Effect<A, E, R>) =>
    effect.pipe(
      Effect.timeout(STEP_TIMEOUT),
      Effect.mapError(classify),
      Effect.tapError((error) => (error._tag === "Outbox.Transient" && error.unreachable ? reachability.unreachable(server) : Effect.void)),
      Effect.tap(() => reachability.reached(server)),
    );

  const makeFolder = (server: ServerAddress, folder: { readonly root: string; readonly name: string }) =>
    step(server, folders.make(server, folder.root, folder.name));

  const makeSession = (client: OpencodeClient, lane: Lane, directory: AbsolutePath, message: QueuedMessage) =>
    step(
      lane.server,
      client["server.session"]["session.create"]({
        payload: {
          id: lane.sessionID,
          agent: message.agent,
          model: message.model,
          location: { directory },
        },
      }),
    );

  /** Where the lane's session runs, recorded on the lane once known: given
   * when queued; for a session in a new folder, the folder's path once made;
   * for an existing session queued before its folder was known, the
   * server's. */
  const directoryOf = (key: LaneKey, lane: Lane, client: OpencodeClient): Effect.Effect<AbsolutePath, Transient | Refused> => {
    if (lane.directory !== undefined) return Effect.succeed(lane.directory);
    const folder = lane.create?.folder;
    const found =
      folder !== undefined
        ? makeFolder(lane.server, folder).pipe(Effect.map((path) => AbsolutePath.make(path)))
        : lane.create === undefined
          ? step(lane.server, client["server.session"]["session.get"]({ params: { sessionID: lane.sessionID } })).pipe(Effect.map((session) => session.data.location.directory))
          : Effect.fail(new Refused({ reason: "The new session has no folder to run in." }));
    return found.pipe(Effect.tap((directory) => updateLane(key, (current) => Lane.make({ ...current, directory }))));
  };

  const sendV2 = (client: OpencodeClient, lane: Lane, message: QueuedMessage) =>
    Effect.gen(function* () {
      if (message.model !== undefined) {
        yield* step(lane.server, client["server.session"]["session.switchModel"]({ params: { sessionID: lane.sessionID }, payload: { model: message.model } }));
      }
      yield* step(
        lane.server,
        client["server.session"]["session.prompt"]({
          params: { sessionID: lane.sessionID },
          payload: {
            id: message.id,
            prompt: {
              text: message.text,
              files: message.files.map((file) => ({ uri: `file://${file.path}`, mime: "text/plain", name: file.name })),
            },
            delivery: "queue",
          },
        }),
      );
    });

  const sendV1 = (lane: Lane, directory: AbsolutePath, message: QueuedMessage) =>
    HttpClientRequest.post(`${lane.server}/session/${lane.sessionID}/prompt_async`).pipe(
      HttpClientRequest.setUrlParam("directory", directory),
      HttpClientRequest.schemaBodyJson(V1Prompt)({
        messageID: message.id,
        agent: message.agent,
        model: message.model === undefined ? undefined : { providerID: message.model.providerID, modelID: message.model.id },
        parts: [
          { type: "text", text: message.text },
          ...message.files.map((file): typeof V1Part.Type => ({ type: "file", mime: "text/plain", url: `file://${file.path}`, filename: file.name })),
        ],
      }),
      Effect.flatMap((request) => HttpClient.filterStatusOk(http).execute(request)),
      (effect) => step(lane.server, effect),
    );

  /** Sends a lane's first message, waiting for the server and retrying what
   * may clear; fails only with what holds the lane. Each attempt reads the
   * lane afresh, so what an earlier attempt finished (the folder, the
   * session) is not done again. */
  const deliver = (key: LaneKey, message: QueuedMessage): Effect.Effect<void, Refused> =>
    Effect.gen(function* () {
      const found = yield* laneOf(key);
      if (Option.isNone(found)) return;
      const lane = found.value;
      yield* reachability.awaitReachable(lane.server);
      const client = yield* opencode.client(lane.server);
      const directory = yield* directoryOf(key, lane, client);
      if (lane.create !== undefined) {
        yield* makeSession(client, lane, directory, message);
        yield* updateLane(key, (current) => Lane.make({ ...current, create: undefined }));
      }
      if (lane.protocol === "v2") yield* sendV2(client, lane, message);
      else yield* sendV1(lane, directory, message);
    }).pipe(
      // What may clear is retried for as long as it takes (awaiting the server
      // each time); only a refusal ends it.
      Effect.retry({ while: (error) => error._tag === "Outbox.Transient", schedule: retrySchedule }),
      Effect.catchTag("Outbox.Transient", (error) => Effect.fail(new Refused({ reason: errorMessage(error.cause) }))),
    );

  /** Sends a lane's messages in order until it is empty or held. */
  const drainLane = (key: LaneKey): Effect.Effect<void> =>
    laneOf(key).pipe(
      Effect.flatMap(
        Option.match({
          onNone: () => Effect.void,
          onSome: (lane) => {
            const head = lane.messages[0];
            if (head === undefined) return updateLane(key, () => undefined);
            if (lane.held !== undefined) return Effect.void;
            return deliver(key, head).pipe(
              Effect.matchEffect({
                onSuccess: () =>
                  updateLane(key, (current) => {
                    const messages = current.messages.filter((message) => message.id !== head.id);
                    return messages.length === 0 ? undefined : Lane.make({ ...current, messages });
                  }).pipe(Effect.andThen(Effect.suspend(() => drainLane(key)))),
                onFailure: (refused) =>
                  Effect.logError(`[outbox] holding ${key}: ${refused.reason}`).pipe(
                    Effect.andThen(updateLane(key, (current) => Lane.make({ ...current, held: Held.make({ messageID: head.id, reason: refused.reason, at: Date.now() }) }))),
                  ),
              }),
            );
          },
        }),
      ),
    );

  const workers = yield* FiberMap.make<LaneKey>();
  const work = (key: LaneKey) => FiberMap.run(workers, key, drainLane(key), { onlyIfMissing: true }).pipe(Effect.asVoid);

  // Whatever was queued last time starts again.
  yield* SubscriptionRef.get(state).pipe(Effect.flatMap((lanes) => Effect.forEach(HashMap.keys(lanes), work, { discard: true })));

  return {
    /** Queues a message (its session's lane, made if new) and starts sending. */
    send: (input: Send): Effect.Effect<QueuedMessage> =>
      Effect.gen(function* () {
        const message = QueuedMessage.make({
          id: SessionMessage.ID.create(),
          text: input.text,
          files: input.files.map((file) => Attachment.make(file)),
          model: input.model,
          agent: input.agent,
          queuedAt: Date.now(),
        });
        const key = laneKey(input.server, input.sessionID);
        yield* SubscriptionRef.update(state, (lanes) =>
          HashMap.set(
            lanes,
            key,
            Option.match(HashMap.get(lanes, key), {
              onNone: () =>
                Lane.make({
                  server: input.server,
                  sessionID: input.sessionID,
                  protocol: input.protocol,
                  directory: input.directory,
                  create:
                    input.create === undefined
                      ? undefined
                      : NewSession.make({ folder: input.create.folder === undefined ? undefined : NewFolder.make(input.create.folder) }),
                  messages: [message],
                }),
              onSome: (lane) => Lane.make({ ...lane, messages: [...lane.messages, message] }),
            }),
          ),
        );
        yield* work(key);
        return message;
      }),
    /** Sends a held lane again from its first message. */
    retry: (server: ServerAddress, sessionID: SessionID) => {
      const key = laneKey(server, sessionID);
      return updateLane(key, (lane) => Lane.make({ ...lane, held: undefined })).pipe(Effect.andThen(work(key)));
    },
    /** Takes a message out (a held one included, which frees its lane). */
    remove: (server: ServerAddress, sessionID: SessionID, messageID: SessionMessage.ID) => {
      const key = laneKey(server, sessionID);
      return updateLane(key, (lane) => {
        const messages = lane.messages.filter((message) => message.id !== messageID);
        if (messages.length === 0) return undefined;
        return Lane.make({ ...lane, messages, held: lane.held?.messageID === messageID ? undefined : lane.held });
      }).pipe(Effect.andThen(work(key)));
    },
    /** Every lane, as it changes. */
    changes: SubscriptionRef.changes(state),
    /** Waits until nothing is left to send (every lane empty or held). */
    drain: SubscriptionRef.changes(state).pipe(
      Stream.filter((lanes) => Array.from(HashMap.values(lanes)).every((lane) => lane.held !== undefined || lane.messages.length === 0)),
      Stream.take(1),
      Stream.runDrain,
    ),
  };
});

export class Outbox extends Context.Service<Outbox, Effect.Success<typeof make>>()("@doubleagent/outbox/Outbox") {
  static readonly layer = Layer.effect(Outbox, make);
}

