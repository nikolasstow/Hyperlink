/**
 * A v2 session's messages, live (opencode v2's model: a snapshot, then events).
 *
 * Each connection: subscribe to the server's event stream first (events
 * waiting in a queue), then load the session's messages, then apply what
 * waited and what follows (messageProjection.ts: durable events through
 * opencode's own updater, the streamed text as its client applies it). The
 * stream misses what happens while it is down (by contract), so when it ends
 * or fails the whole thing starts again from a fresh load, backing off.
 *
 * The first load is published as soon as it is in; after that, a snapshot
 * after each change (consumers coalesce them, useV2Transcript.ts).
 *
 * @internal
 */
import { Cause, Data, Duration, Effect, Queue, Schedule, Schema, Stream, SubscriptionRef } from "effect";
import { Opencode } from "../opencode/Opencode";
import type { ServerAddress } from "../opencode/serverAddress";
import { SessionEvent } from "../opencode/schema/session-event";
import type { SessionID } from "../opencode/schema/session-id";
import type { SessionMessage } from "../opencode/schema/session-message";
import { applyDurable, applyStreaming, isStreaming, type Projection } from "./messageProjection";

const RECONNECT_FIRST = "500 millis";
const RECONNECT_LONGEST = Duration.seconds(10);
/** Messages a page of the history holds (the most the server gives). */
const PAGE = 200;

const reconnect = Schedule.exponential(RECONNECT_FIRST).pipe(
  Schedule.modifyDelay(({ duration }) => Effect.succeed(Duration.min(duration, RECONNECT_LONGEST))),
  Schedule.jittered,
);

const isSessionEvent = Schema.is(SessionEvent.All);
const isDurable = Schema.is(SessionEvent.Durable);

/** A loaded message the projection keeps: every type but the location switch,
 * which the server sends in its public form and the chat does not show. */
const projected = <M extends { readonly type: string }>(message: M): message is Exclude<M, { readonly type: "location-switched" }> =>
  message.type !== "location-switched";

/** The event stream ended or failed: the connection starts again. */
class EventsDropped extends Data.TaggedError("EventsDropped")<{
  readonly cause: unknown;
}> {}

/** The session's messages, in order, as they change. */
export const v2Transcript = (server: ServerAddress, sessionID: SessionID): Stream.Stream<ReadonlyArray<SessionMessage.Info>, never, Opencode> =>
  Stream.unwrap(
    Effect.gen(function* () {
      const opencode = yield* Opencode;
      const client = yield* opencode.client(server);
      const messages = yield* SubscriptionRef.make<ReadonlyArray<SessionMessage.Info>>([]);
      const projection: Projection = { messages: [] };
      const publish = Effect.suspend(() => SubscriptionRef.set(messages, projection.messages));

      /** Every message, oldest first, page by page. */
      const loadAll = Effect.gen(function* () {
        const loaded: Array<SessionMessage.Info> = [];
        let cursor: string | undefined;
        for (;;) {
          const page = yield* client["server.message"]["session.messages"]({
            params: { sessionID },
            query: cursor === undefined ? { limit: PAGE, order: "asc" } : { limit: PAGE, cursor },
          });
          loaded.push(...page.data.filter(projected));
          if (page.cursor.next === undefined || page.data.length === 0) return loaded;
          cursor = page.cursor.next;
        }
      });

      const connection = Effect.gen(function* () {
        const waiting = yield* Queue.unbounded<SessionEvent.Event, EventsDropped | Cause.Done>();
        const events = yield* client["server.event"]["event.subscribe"]();
        yield* events.pipe(
          Stream.mapError((cause) => new EventsDropped({ cause })),
          Stream.filter(isSessionEvent),
          Stream.filter((event) => event.data.sessionID === sessionID),
          Stream.runIntoQueue(waiting),
          Effect.forkScoped,
        );
        projection.messages = yield* loadAll;
        yield* publish;
        yield* Stream.fromQueue(waiting).pipe(
          Stream.runForEach((event) =>
            (isDurable(event) ? applyDurable(projection, event) : Effect.sync(() => (isStreaming(event) ? applyStreaming(projection, event) : undefined))).pipe(
              Effect.andThen(publish),
            ),
          ),
        );
      }).pipe(Effect.scoped);

      yield* connection.pipe(
        Effect.catchCause((cause) => Effect.logWarning("[transcript] the session's events dropped; loading again", cause)),
        Effect.repeat(reconnect),
        Effect.forkScoped,
      );

      return SubscriptionRef.changes(messages);
    }),
  );
