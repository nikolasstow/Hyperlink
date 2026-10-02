/**
 * A v2 session's messages, live: opencode's own projection (the vendored
 * message updater) folded over the session's events, exactly as the server
 * builds them.
 *
 * - **Durable events** come from the session's event stream
 *   (`/api/session/:id/event?after=seq`): every durable event after a
 *   sequence, in order, then new ones as they happen. Dropped, it reconnects
 *   after the last one applied, so nothing is missed or applied twice.
 * - **Deltas** (text and reasoning arriving as they are written) are not
 *   durable; they come from the server's event stream, filtered to this
 *   session. A delta for text that has ended is dropped, so a late one cannot
 *   add to finished text (the durable "ended" carries the full text anyway).
 *
 * Both reconnect with backoff for as long as the stream is read. Nothing is
 * published while the history replays (a chat shows the messages the device
 * kept meanwhile); once events go quiet for `REPLAY_QUIET` it is caught up,
 * and from then a snapshot is published after each change; consumers
 * coalesce them (useV2Transcript.ts).
 *
 * @internal
 */
import { Duration, Effect, FiberHandle, HashSet, Ref, Schedule, Stream, SubscriptionRef } from "effect";
import { memory, type MemoryState, update } from "../opencode/core/message-updater";
import { Opencode } from "../opencode/Opencode";
import type { ServerAddress } from "../opencode/serverAddress";
import type { SessionEvent } from "../opencode/schema/session-event";
import type { SessionID } from "../opencode/schema/session-id";
import type { SessionMessage } from "../opencode/schema/session-message";

const RECONNECT_FIRST = "500 millis";
const RECONNECT_LONGEST = Duration.seconds(10);
/** No event for this long while replaying: the history is in. */
const REPLAY_QUIET = Duration.millis(250);

const reconnect = Schedule.exponential(RECONNECT_FIRST).pipe(
  Schedule.modifyDelay(({ duration }) => Effect.succeed(Duration.min(duration, RECONNECT_LONGEST))),
  Schedule.jittered,
);

/** Runs `connect` again whenever it ends or fails, backing off, forever. */
const keepConnected = <E, R>(name: string, connect: Effect.Effect<void, E, R>) =>
  connect.pipe(
    Effect.catchCause((cause) => Effect.logWarning(`[transcript] ${name} dropped`, cause)),
    Effect.repeat(reconnect),
    Effect.asVoid,
  );

/** A delta's event: what it adds to, and which session. */
type Delta = Extract<SessionEvent.Event, { readonly type: "session.next.text.delta" | "session.next.reasoning.delta" }>;

const isDelta = (event: { readonly type: string }): event is Delta =>
  event.type === "session.next.text.delta" || event.type === "session.next.reasoning.delta";

/** The id of the text or reasoning a delta or its "ended" belongs to. */
const blockOf = (event: SessionEvent.Event): string | undefined => {
  switch (event.type) {
    case "session.next.text.delta":
    case "session.next.text.ended":
      return event.data.textID;
    case "session.next.reasoning.delta":
    case "session.next.reasoning.ended":
      return event.data.reasoningID;
    default:
      return undefined;
  }
};

/** The session's messages, in order, as they change. */
export const v2Transcript = (server: ServerAddress, sessionID: SessionID): Stream.Stream<ReadonlyArray<SessionMessage.Message>, never, Opencode> =>
  Stream.unwrap(
    Effect.gen(function* () {
      const opencode = yield* Opencode;
      const client = yield* opencode.client(server);
      // The updater's in-memory projection: it replaces a message it touches
      // (immer) and appends new ones, in this array.
      const state: MemoryState = { messages: [] };
      const adapter = memory(state);
      const messages = yield* SubscriptionRef.make<ReadonlyArray<SessionMessage.Message>>([]);
      const lastSeq = yield* Ref.make(0);
      const ended = yield* Ref.make(HashSet.empty<string>());
      // A snapshot of the projection as it is when this runs.
      const publish = Effect.suspend(() => SubscriptionRef.set(messages, [...state.messages]));
      // Caught up once the replay goes quiet; until then each event only
      // pushes that moment back.
      const caughtUp = yield* Ref.make(false);
      const quiet = yield* FiberHandle.make();
      const settle = FiberHandle.run(quiet, Effect.sleep(REPLAY_QUIET).pipe(Effect.andThen(Ref.set(caughtUp, true)), Effect.andThen(publish)));
      const changed = Effect.flatMap(Ref.get(caughtUp), (live) => (live ? publish : settle));

      const applyDurable = (event: SessionEvent.Event) =>
        Effect.gen(function* () {
          const seq = event.durable?.seq;
          if (seq !== undefined && seq <= (yield* Ref.get(lastSeq))) return;
          yield* update(adapter, event);
          if (seq !== undefined) yield* Ref.set(lastSeq, seq);
          const block = blockOf(event);
          if (block !== undefined) yield* Ref.update(ended, HashSet.add(block));
          yield* changed;
        });

      const applyDelta = (event: Delta) =>
        Effect.gen(function* () {
          const block = blockOf(event);
          if (block !== undefined && HashSet.has(yield* Ref.get(ended), block)) return;
          yield* update(adapter, event);
          yield* changed;
        });

      // A session with no history yet is caught up as soon as it is quiet.
      yield* settle;

      yield* keepConnected(
        "session events",
        Effect.gen(function* () {
          const after = yield* Ref.get(lastSeq);
          const events = yield* client["server.session"]["session.events"]({ params: { sessionID }, query: { after } });
          yield* Stream.runForEach(events, applyDurable);
        }),
      ).pipe(Effect.forkScoped);

      yield* keepConnected(
        "deltas",
        Effect.gen(function* () {
          const events = yield* client["server.event"]["event.subscribe"]();
          yield* events.pipe(
            Stream.filter(isDelta),
            Stream.filter((event) => event.data.sessionID === sessionID),
            Stream.runForEach(applyDelta),
          );
        }),
      ).pipe(Effect.forkScoped);

      return SubscriptionRef.changes(messages);
    }),
  );
