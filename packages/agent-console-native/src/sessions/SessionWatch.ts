/**
 * What a server's sessions are doing, live (opencode v2's event stream): which
 * are running, when each last did anything, their titles as they are named or
 * renamed, and the permission asks waiting on an answer. Sessions on allow all (sessionPermissions.ts) have their asks
 * answered here, `once`, as they come.
 *
 * Each connection: subscribe first (events wait in a queue), then load what
 * is true now (the running sessions, and their pending asks), then apply what
 * waited and what follows. The stream misses what happens while it is down
 * (by contract), so when it ends or fails it starts again from a fresh load.
 *
 * A server is watched while something holds it (`hold`, scoped); the last
 * holder letting go closes its connection after a moment.
 *
 * @internal
 */
import { Cause, Context, Data, Duration, Effect, Layer, Queue, RcMap, Schedule, Stream, SubscriptionRef } from "effect";
import { getPermissionMode } from "../sessionPermissions";
import { Opencode } from "../opencode/Opencode";
import type { OpenCodeEvent } from "../opencode/protocol/groups/event";
import type { Permission } from "../opencode/schema/permission";
import { SessionID } from "../opencode/schema/session-id";
import type { ServerAddress } from "../opencode/serverAddress";

const RECONNECT_FIRST = "500 millis";
const RECONNECT_LONGEST = Duration.seconds(10);
/** How long a connection stays after its last holder lets go. */
const KEEP_CONNECTION = Duration.seconds(5);

const reconnect = Schedule.exponential(RECONNECT_FIRST).pipe(
  Schedule.modifyDelay(({ duration }) => Effect.succeed(Duration.min(duration, RECONNECT_LONGEST))),
  Schedule.jittered,
);

/** One server's sessions, as last known. */
export interface Watched {
  /** Whether the event stream is up (what follows is live). */
  readonly connected: boolean;
  /** Sessions running now. */
  readonly busy: ReadonlySet<string>;
  /** The latest moment each session did anything (epoch ms), seen live. */
  readonly activityAt: ReadonlyMap<string, number>;
  /** Permission asks waiting on an answer, oldest first. */
  readonly asks: ReadonlyArray<Permission.Request>;
  /** Titles given since the stream connected (v2 names a session a moment
   * after its first message), by session. */
  readonly titles: ReadonlyMap<string, string>;
}

export const NOTHING_WATCHED: Watched = { connected: false, busy: new Set(), activityAt: new Map(), asks: [], titles: new Map() };

/** The event stream ended or failed: the connection starts again. */
class EventsDropped extends Data.TaggedError("EventsDropped")<{
  readonly cause: unknown;
}> {}

const RUNNING: ReadonlySet<string> = new Set(["session.execution.started"]);
const STOPPED: ReadonlySet<string> = new Set(["session.execution.succeeded", "session.execution.failed", "session.execution.interrupted", "session.idle", "session.deleted"]);

const withBusy = (watched: Watched, sessionID: string, on: boolean): Watched => {
  if (watched.busy.has(sessionID) === on) return watched;
  const busy = new Set(watched.busy);
  if (on) busy.add(sessionID);
  else busy.delete(sessionID);
  return { ...watched, busy };
};

const withActivity = (watched: Watched, sessionID: string, at: number): Watched => {
  if ((watched.activityAt.get(sessionID) ?? 0) >= at) return watched;
  const activityAt = new Map(watched.activityAt);
  activityAt.set(sessionID, at);
  return { ...watched, activityAt };
};

/** The session an event is about, when it is about one. */
const sessionOf = (event: OpenCodeEvent): string | undefined =>
  event.type.startsWith("session.") && "sessionID" in event.data && typeof event.data.sessionID === "string" ? event.data.sessionID : undefined;

/** What `event` changes. */
const applied = (watched: Watched, event: OpenCodeEvent): Watched => {
  if (event.type === "permission.asked") {
    return watched.asks.some((ask) => ask.id === event.data.id) ? watched : { ...watched, asks: [...watched.asks, event.data] };
  }
  if (event.type === "permission.replied") {
    return { ...watched, asks: watched.asks.filter((ask) => ask.id !== event.data.requestID) };
  }
  const sessionID = sessionOf(event);
  if (sessionID === undefined) return watched;
  const touched = withActivity(watched, sessionID, "created" in event ? event.created : Date.now());
  if (event.type === "session.renamed") return { ...touched, titles: new Map(touched.titles).set(sessionID, event.data.title) };
  if (event.type === "session.status") return withBusy(touched, sessionID, event.data.status.type !== "idle");
  if (RUNNING.has(event.type)) return withBusy(touched, sessionID, true);
  if (STOPPED.has(event.type)) return withBusy(touched, sessionID, false);
  return touched;
};

const make = Effect.gen(function* () {
  const opencode = yield* Opencode;
  const watched = yield* SubscriptionRef.make<ReadonlyMap<ServerAddress, Watched>>(new Map());

  const update = (server: ServerAddress, change: (current: Watched) => Watched) =>
    SubscriptionRef.update(watched, (all) => {
      const current = all.get(server) ?? NOTHING_WATCHED;
      const next = change(current);
      return next === current ? all : new Map(all).set(server, next);
    });

  /** Answers an ask. */
  const reply = (server: ServerAddress, ask: Permission.Request, decision: Permission.Reply) =>
    opencode.client(server).pipe(
      Effect.flatMap((client) =>
        client["server.permission"]["session.permission.reply"]({ params: { sessionID: ask.sessionID, requestID: ask.id }, payload: { decision } }),
      ),
    );

  /** Answers an ask `once` when its session is on allow all. */
  const approve = (server: ServerAddress, ask: Permission.Request) =>
    getPermissionMode(ask.sessionID) !== "full"
      ? Effect.void
      : reply(server, ask, "once").pipe(Effect.catchCause((cause) => Effect.logError(`[permissions] approving ${ask.id} (${ask.action}) failed`, cause)));

  const connection = (server: ServerAddress) =>
    Effect.gen(function* () {
      const client = yield* opencode.client(server);
      const waiting = yield* Queue.unbounded<OpenCodeEvent, EventsDropped | Cause.Done>();
      const events = yield* client["server.event"]["event.subscribe"]();
      yield* events.pipe(
        Stream.mapError((cause) => new EventsDropped({ cause })),
        Stream.runIntoQueue(waiting),
        Effect.forkScoped,
      );
      const running = Object.keys((yield* client["server.session"]["session.active"]()).data).map((id) => SessionID.make(id));
      const asks = yield* Effect.forEach(
        running,
        (sessionID) => client["server.permission"]["session.permission.list"]({ params: { sessionID } }).pipe(Effect.map((response) => response.data)),
        { concurrency: 4 },
      );
      yield* update(server, (current) => ({ ...current, connected: true, busy: new Set(running), asks: asks.flat() }));
      yield* Effect.forEach(asks.flat(), (ask) => approve(server, ask), { discard: true });
      yield* Stream.fromQueue(waiting).pipe(
        Stream.runForEach((event) =>
          update(server, (current) => applied(current, event)).pipe(Effect.andThen(event.type === "permission.asked" ? approve(server, event.data) : Effect.void)),
        ),
      );
    }).pipe(
      Effect.scoped,
      Effect.ensuring(update(server, (current) => (current.connected ? { ...current, connected: false } : current))),
    );

  const connections = yield* RcMap.make({
    lookup: (server: ServerAddress) =>
      connection(server).pipe(
        Effect.catchCause((cause) => Effect.logWarning("[sessions] the server's events dropped; loading again", cause)),
        Effect.repeat(reconnect),
        Effect.forkScoped,
      ),
    idleTimeToLive: KEEP_CONNECTION,
  });

  return {
    /** Every watched server's sessions, as they change. */
    changes: SubscriptionRef.changes(watched),
    /** Watches `server` while the scope is open. */
    hold: (server: ServerAddress) => RcMap.get(connections, server).pipe(Effect.asVoid),
    /** Answers a permission ask. */
    reply,
  };
});

export class SessionWatch extends Context.Service<SessionWatch, Effect.Success<typeof make>>()("@doubleagent/sessions/SessionWatch") {
  static readonly layer = Layer.effect(SessionWatch, make);
}
