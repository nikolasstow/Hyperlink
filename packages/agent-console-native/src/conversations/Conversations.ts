/**
 * The device's copy of conversations, so a chat opens on its messages with
 * nothing to fetch: the newest of each (enough to fill the screen and more),
 * kept before anyone taps.
 *
 * - **Preloaded** for the sessions someone might open next: every button
 *   that opens a session asks for its own (usePreloadConversation.ts), and
 *   the most recent are asked for when the app opens or comes back. A
 *   session the server has not changed since it was kept is not fetched
 *   again; one already being fetched is not fetched twice; a few at a time.
 * - **Kept current by the chat**: an open chat hands back its newest
 *   messages as they change, so the next open starts from them.
 * - **On the device** (KeyValueStore, one entry per conversation, writes
 *   coalesced), read back at launch.
 *
 * What is older loads once the chat is open (its own history and live
 * stream).
 *
 * @internal
 */
import { Context, Duration, Effect, FiberMap, HashMap, Layer, Option, Schema, Semaphore, Stream, SubscriptionRef } from "effect";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";
import { KeyValueStore } from "effect/unstable/persistence";
import { chatMessagesOfV1History } from "../chat/fromV1";
import { chatMessagesOfV2 } from "../chat/fromV2";
import type { ChatMessage } from "../chat/model";
import { Opencode } from "../opencode/Opencode";
import type { ServerAddress } from "../opencode/serverAddress";
import { SessionID } from "../opencode/schema/session-id";
import type { Protocol } from "../outbox/model";
import { sessionProtocol } from "../sessions/protocol";
import { Conversation, conversationKey, ConversationKeys } from "./model";

/** Messages kept per conversation: a screenful and more. */
export const KEPT_MESSAGES = 30;
/** Conversations fetched at once while preloading. */
const PRELOAD_CONCURRENCY = 3;
/** Writes to the device, coalesced per conversation. */
const PERSIST_DEBOUNCE = Duration.millis(500);
const KEYS_KEY = "keys";

/** v1's history page, as far as the chat reads it. */
const V1History = Schema.Array(
  Schema.Struct({
    info: Schema.Struct({
      id: Schema.String,
      role: Schema.Literals(["user", "assistant"]),
      providerID: Schema.optional(Schema.String),
      modelID: Schema.optional(Schema.String),
      time: Schema.Struct({
        created: Schema.Number,
        completed: Schema.optional(Schema.Number),
      }),
    }),
    parts: Schema.Array(Schema.Unknown),
  }),
);

type Kept = HashMap.HashMap<string, Conversation>;

/** A session to keep: which, and when the server last changed it (ms). */
export interface Wanted {
  readonly id: string;
  readonly updated: number;
}

/** The newest `KEPT_MESSAGES` of a conversation. */
export const newest = (messages: ReadonlyArray<ChatMessage>): ReadonlyArray<ChatMessage> =>
  messages.length <= KEPT_MESSAGES ? messages : messages.slice(messages.length - KEPT_MESSAGES);

const make = Effect.gen(function* () {
  const opencode = yield* Opencode;
  const http = yield* HttpClient.HttpClient;
  const kv = yield* KeyValueStore.KeyValueStore;
  const conversations = KeyValueStore.toSchemaStore(kv, Conversation);
  const keys = KeyValueStore.toSchemaStore(kv, ConversationKeys);

  // What the device kept when the app last ran. One that no longer reads is
  // left out, said.
  const storedKeys = yield* keys.get(KEYS_KEY).pipe(
    Effect.map(Option.getOrElse((): ReadonlyArray<string> => [])),
    Effect.catch((error) => Effect.logError("[conversations] the kept list could not be read; starting without it", error).pipe(Effect.as([]))),
  );
  const stored = yield* Effect.forEach(
    storedKeys,
    (key) =>
      conversations.get(key).pipe(
        Effect.map(Option.map((conversation): readonly [string, Conversation] => [key, conversation])),
        Effect.catch((error) => Effect.logError(`[conversations] ${key} could not be read; leaving it out`, error).pipe(Effect.as(Option.none()))),
      ),
    { concurrency: "unbounded" },
  );
  const state = yield* SubscriptionRef.make<Kept>(HashMap.fromIterable(stored.flatMap(Option.toArray)));

  const writers = yield* FiberMap.make<string>();
  const persist = (key: string) =>
    FiberMap.run(
      writers,
      key,
      Effect.sleep(PERSIST_DEBOUNCE).pipe(
        Effect.andThen(SubscriptionRef.get(state)),
        Effect.flatMap((kept) =>
          Option.match(HashMap.get(kept, key), {
            onNone: () => conversations.remove(key),
            onSome: (conversation) => conversations.set(key, conversation),
          }).pipe(Effect.andThen(keys.set(KEYS_KEY, Array.from(HashMap.keys(kept))))),
        ),
        Effect.catch((error) => Effect.logError(`[conversations] saving ${key} failed`, error)),
      ),
    );

  const keep = (key: string, conversation: Conversation) =>
    SubscriptionRef.update(state, HashMap.set(key, conversation)).pipe(Effect.andThen(persist(key)), Effect.asVoid);

  const v1Newest = (server: ServerAddress, sessionID: string) =>
    http.get(`${server}/session/${sessionID}/message`, { urlParams: { limit: String(KEPT_MESSAGES) } }).pipe(
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      Effect.flatMap(HttpClientResponse.schemaBodyJson(V1History)),
      Effect.map(chatMessagesOfV1History),
    );

  const v2Newest = (server: ServerAddress, sessionID: SessionID) =>
    opencode.client(server).pipe(
      Effect.flatMap((client) => client["server.message"]["session.messages"]({ params: { sessionID }, query: { limit: KEPT_MESSAGES, order: "desc" } })),
      Effect.map((page) => chatMessagesOfV2([...page.data].reverse())),
    );

  const fetching = yield* Semaphore.make(PRELOAD_CONCURRENCY);
  const inFlight = yield* FiberMap.make<string>();

  /** Keeps a session's newest messages, unless kept already as the server
   * has it. */
  const refresh = (server: ServerAddress, session: Wanted) =>
    Effect.gen(function* () {
      const key = conversationKey(server, session.id);
      const kept = HashMap.get(yield* SubscriptionRef.get(state), key);
      if (Option.isSome(kept) && kept.value.updated >= session.updated) return;
      const sessionID = SessionID.make(session.id);
      const protocol: Protocol = Option.isSome(kept)
        ? kept.value.protocol
        : yield* sessionProtocol(server, sessionID).pipe(Effect.provideService(HttpClient.HttpClient, http), Effect.provideService(Opencode, opencode));
      const messages = protocol === "v1" ? yield* v1Newest(server, session.id) : yield* v2Newest(server, sessionID);
      yield* keep(key, { protocol, updated: session.updated, messages });
    }).pipe(
      fetching.withPermits(1),
      Effect.catchCause((cause) => Effect.logWarning(`[conversations] preloading ${session.id} failed`, cause)),
    );

  /** Starts keeping a session (in the background), unless it already is. */
  const want = (server: ServerAddress, session: Wanted) =>
    FiberMap.run(inFlight, conversationKey(server, session.id), refresh(server, session), { onlyIfMissing: true }).pipe(Effect.asVoid);

  return {
    /** Every conversation kept, as it changes (the current one first). */
    changes: SubscriptionRef.changes(state),
    /** Starts keeping these sessions' newest messages, most recent first. */
    preload: (server: ServerAddress, sessions: ReadonlyArray<Wanted>) =>
      Effect.forEach(
        [...sessions].sort((a, b) => b.updated - a.updated),
        (session) => want(server, session),
        { discard: true },
      ),
    /** An open chat's newest messages, kept as they change. */
    remember: (server: ServerAddress, sessionID: string, protocol: Protocol, messages: ReadonlyArray<ChatMessage>) =>
      keep(conversationKey(server, sessionID), { protocol, updated: Date.now(), messages: newest(messages) }),
  };
});

export class Conversations extends Context.Service<Conversations, Effect.Success<typeof make>>()("@doubleagent/conversations/Conversations") {
  static readonly layer = Layer.effect(Conversations, make);
}

/** What is kept, as it changes, for React. */
export const conversationChanges = Stream.unwrap(
  Effect.gen(function* () {
    const conversations = yield* Conversations;
    return conversations.changes;
  }),
);
