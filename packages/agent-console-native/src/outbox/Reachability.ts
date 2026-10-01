/**
 * Whether each server can be reached, as a `SubscriptionRef` per server, so
 * whatever is waiting on a server resumes the moment it is back.
 *
 * Fed by what actually happens: a send that gets through says reachable, a
 * transport failure says unreachable, the device going offline says so for
 * every server. While a server is unreachable and something waits on it, a
 * health probe backs off exponentially (with jitter, capped); the network
 * returning or the app coming back to the foreground restarts it at once.
 * Nothing probes while everything is reachable, or while nothing waits.
 *
 * A server is taken as reachable until shown otherwise: the first send just
 * goes, rather than waiting on a probe.
 *
 * @internal
 */
import { Context, Duration, Effect, FiberMap, HashMap, Layer, Option, Schedule, Stream, SubscriptionRef, SynchronizedRef } from "effect";
import { DeviceSignals } from "../effect/DeviceSignals";
import { Opencode } from "../opencode/Opencode";
import type { ServerAddress } from "../opencode/serverAddress";

/** The probe's first wait, and its longest. */
const PROBE_FIRST = "1 second";
const PROBE_LONGEST = Duration.seconds(30);
/** How long a health check may take before it counts as unreachable. */
const PROBE_TIMEOUT = "5 seconds";

const probeSchedule = Schedule.exponential(PROBE_FIRST).pipe(
  Schedule.modifyDelay(({ duration }) => Effect.succeed(Duration.min(duration, PROBE_LONGEST))),
  Schedule.jittered,
);

type States = HashMap.HashMap<ServerAddress, SubscriptionRef.SubscriptionRef<boolean>>;

const make = Effect.gen(function* () {
  const opencode = yield* Opencode;
  const device = yield* DeviceSignals;
  const states = yield* SynchronizedRef.make<States>(HashMap.empty());
  // One probe per server, while it is unreachable and waited on.
  const probes = yield* FiberMap.make<ServerAddress>();

  const stateOf = (server: ServerAddress) =>
    SynchronizedRef.modifyEffect(states, (known): Effect.Effect<readonly [SubscriptionRef.SubscriptionRef<boolean>, States]> =>
      Option.match(HashMap.get(known, server), {
        onSome: (state) => Effect.succeed([state, known]),
        onNone: () => SubscriptionRef.make(true).pipe(Effect.map((state) => [state, HashMap.set(known, server, state)])),
      }),
    );

  const set = (server: ServerAddress, reachable: boolean) =>
    stateOf(server).pipe(Effect.flatMap((state) => SubscriptionRef.set(state, reachable)));

  const healthy = (server: ServerAddress) =>
    opencode.client(server).pipe(
      Effect.flatMap((client) => client["server.health"]["health.get"]()),
      Effect.timeout(PROBE_TIMEOUT),
    );

  /** Checks until the server answers, then marks it reachable. */
  const probe = (server: ServerAddress) =>
    healthy(server).pipe(Effect.retry(probeSchedule), Effect.andThen(set(server, true)));

  /** Starts (or restarts, from the first wait) the probes of every server
   * that is unreachable. */
  const reprobe = SynchronizedRef.get(states).pipe(
    Effect.flatMap((known) =>
      Effect.forEach(
        known,
        ([server, state]) =>
          SubscriptionRef.get(state).pipe(
            Effect.flatMap((reachable) => (reachable ? Effect.void : FiberMap.run(probes, server, probe(server)).pipe(Effect.asVoid))),
          ),
        { discard: true },
      ),
    ),
  );

  const offline = SynchronizedRef.get(states).pipe(
    Effect.flatMap((known) => Effect.forEach(known, ([, state]) => SubscriptionRef.set(state, false), { discard: true })),
  );

  yield* device.signals.pipe(
    Stream.runForEach((signal) => (signal === "offline" ? offline : reprobe)),
    Effect.forkScoped,
  );

  return {
    /** Whether the server is reachable, as it changes. */
    changes: (server: ServerAddress) => stateOf(server).pipe(Effect.map(SubscriptionRef.changes), Stream.unwrap),
    /** Waits until the server is reachable (at once if it is), probing it
     * meanwhile. */
    awaitReachable: (server: ServerAddress) =>
      Effect.gen(function* () {
        const state = yield* stateOf(server);
        if (yield* SubscriptionRef.get(state)) return;
        yield* FiberMap.run(probes, server, probe(server), { onlyIfMissing: true });
        yield* SubscriptionRef.changes(state).pipe(Stream.filter((reachable) => reachable), Stream.take(1), Stream.runDrain);
      }),
    /** A request got through. */
    reached: (server: ServerAddress) => set(server, true),
    /** A request could not get through (no answer, no connection). */
    unreachable: (server: ServerAddress) => set(server, false),
  };
});

export class Reachability extends Context.Service<Reachability, Effect.Success<typeof make>>()("@doubleagent/outbox/Reachability") {
  static readonly layer = Layer.effect(Reachability, make);
}
