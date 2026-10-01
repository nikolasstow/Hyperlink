/**
 * The outbox for React: a snapshot of its lanes kept current from the
 * outbox's own stream, read through `useSyncExternalStore`. A change replaces
 * only the lane it touched (the others keep their identity), so a component
 * reading one lane re-renders only when that lane changes.
 *
 * `startOutbox` (once, at launch) builds the runtime (the outbox resumes what
 * was queued), starts the mirror and registers the background drain.
 *
 * @internal
 */
import { Effect, HashMap, Option, Stream } from "effect";
import * as React from "react";
import { forkApp, runApp } from "../effect/runtime";
import type { ServerAddress } from "../opencode/serverAddress";
import type { SessionID } from "../opencode/schema/session-id";
import type { SessionMessage } from "../opencode/schema/session-message";
import { registerBackgroundDrain } from "./backgroundDrain";
import { type Lane, laneKey, type LaneKey, type QueuedMessage } from "./model";
import { Outbox, type Send } from "./Outbox";

let lanes: HashMap.HashMap<LaneKey, Lane> = HashMap.empty();
const listeners = new Set<() => void>();
const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Runs `f` with the outbox. */
const withOutbox = <A, E>(f: (outbox: Outbox["Service"]) => Effect.Effect<A, E>) =>
  Effect.gen(function* () {
    const outbox = yield* Outbox;
    return yield* f(outbox);
  });

let started = false;

/** Starts the outbox (once): resumes what was queued, mirrors its lanes for
 * React, registers the background drain. */
export const startOutbox = (): void => {
  if (started) return;
  started = true;
  forkApp(
    Effect.all(
      [
        withOutbox((outbox) =>
          outbox.changes.pipe(
            Stream.runForEach((next) =>
              Effect.sync(() => {
                lanes = next;
                listeners.forEach((listener) => listener());
              }),
            ),
          ),
        ),
        registerBackgroundDrain,
      ],
      { concurrency: "unbounded", discard: true },
    ),
  );
};

/** A session's lane: its messages still to send (in order), whether it is
 * held. Undefined when nothing is queued for it. */
export const useLane = (server: ServerAddress, sessionID: SessionID | undefined): Lane | undefined =>
  React.useSyncExternalStore(subscribe, () =>
    sessionID === undefined ? undefined : Option.getOrUndefined(HashMap.get(lanes, laneKey(server, sessionID))),
  );

/** Queues a message; it is sent from the outbox, in order, when the server
 * can take it. */
export const sendMessage = (input: Send): Promise<QueuedMessage> => runApp(withOutbox((outbox) => outbox.send(input)));

/** Sends a held lane again from its first message. */
export const retryLane = (server: ServerAddress, sessionID: SessionID): Promise<void> => runApp(withOutbox((outbox) => outbox.retry(server, sessionID)));

/** Takes a queued message out. */
export const removeQueued = (server: ServerAddress, sessionID: SessionID, messageID: SessionMessage.ID): Promise<void> =>
  runApp(withOutbox((outbox) => outbox.remove(server, sessionID, messageID)));
