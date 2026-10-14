/**
 * A server's live sessions for React (SessionWatch.ts through the app
 * runtime): `useSessionWatch` watches the server while `enabled` and gives
 * what is known (running sessions, last activity, permission asks);
 * `replyToAsk` answers an ask.
 *
 * @internal
 */
import { Effect, Fiber, Stream } from "effect";
import * as React from "react";
import { forkApp, runApp } from "../effect/runtime";
import type { Permission } from "../opencode/schema/permission";
import type { ServerAddress } from "../opencode/serverAddress";
import { NOTHING_WATCHED, SessionWatch, type Watched } from "./SessionWatch";

let watched: ReadonlyMap<ServerAddress, Watched> = new Map();
const listeners = new Set<() => void>();
let mirrored = false;

/** Mirrors every watched server for React (once, on first use). */
const mirror = (): void => {
  if (mirrored) return;
  mirrored = true;
  forkApp(
    SessionWatch.pipe(
      Effect.map((watch) => watch.changes),
      Stream.unwrap,
      Stream.runForEach((next) =>
        Effect.sync(() => {
          watched = next;
          listeners.forEach((listener) => listener());
        }),
      ),
    ),
  );
};

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** `server`'s sessions, watched while `enabled`. */
export const useSessionWatch = (server: ServerAddress, enabled: boolean = true): Watched => {
  mirror();
  React.useEffect(() => {
    if (!enabled) return undefined;
    const fiber = forkApp(
      SessionWatch.pipe(
        Effect.flatMap((watch) => watch.hold(server)),
        Effect.andThen(Effect.never),
        Effect.scoped,
      ),
    );
    return () => {
      forkApp(Fiber.interrupt(fiber));
    };
  }, [server, enabled]);
  return React.useSyncExternalStore(subscribe, () => watched.get(server) ?? NOTHING_WATCHED);
};

/** Answers a permission ask; rejects when the server does not take it. */
export const replyToAsk = (server: ServerAddress, ask: Permission.Request, decision: Permission.Reply): Promise<void> =>
  runApp(SessionWatch.pipe(Effect.flatMap((watch) => watch.reply(server, ask, decision))));
