/**
 * The paired servers, for React and for every request (ServerAuth.ts):
 * `startServerAuth` (once, at launch) reads them back and keeps
 * serverTokens.ts in step, so requests carry their server's token;
 * `serverAuthReadBack` settles once they are read (the app waits for it
 * before it first connects).
 *
 * @internal
 */
import { Effect, Stream } from "effect";
import * as React from "react";
import { forkApp, runApp } from "../effect/runtime";
import { ServerAuth, type ServerDevices } from "./ServerAuth";
import { setServerTokens } from "./serverTokens";

let paired: ReadonlySet<string> = new Set();
let devices: ReadonlyMap<string, ServerDevices> = new Map();
const listeners = new Set<() => void>();
const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

let started = false;
let readBack: () => void = () => undefined;
/** Settles once the paired servers are read back. */
export const serverAuthReadBack = new Promise<void>((resolve) => {
  readBack = resolve;
});

/** Reads back the paired servers and keeps their tokens in step (once). */
export const startServerAuth = (): void => {
  if (started) return;
  started = true;
  forkApp(
    Effect.gen(function* () {
      return (yield* ServerAuth).devicesChanges;
    }).pipe(
      Stream.unwrap,
      Stream.runForEach((next) =>
        Effect.sync(() => {
          devices = next;
          listeners.forEach((listener) => listener());
        }),
      ),
    ),
  );
  forkApp(
    Effect.gen(function* () {
      const auth = yield* ServerAuth;
      yield* auth.readBack;
      yield* Effect.sync(readBack);
      return auth.changes;
    }).pipe(
      Stream.unwrap,
      Stream.runForEach((tokens) =>
        Effect.sync(() => {
          setServerTokens(tokens);
          paired = new Set(tokens.keys());
          listeners.forEach((listener) => listener());
        }),
      ),
    ),
  );
};

/** The origins this phone is paired with, as they change. */
export const usePairedServers = (): ReadonlySet<string> => React.useSyncExternalStore(subscribe, () => paired);

/** The devices paired with `origin`, as last fetched (at launch and on
 * return to the foreground), if it is paired. */
export const useServerDevices = (origin: string): ServerDevices | undefined => React.useSyncExternalStore(subscribe, () => devices.get(origin));

/** Removes a device from `origin` (this phone's own removal forgets the server here too). */
export const revokeDevice = (origin: string, id: string): Promise<void> =>
  runApp(
    Effect.gen(function* () {
      yield* (yield* ServerAuth).revoke(origin, id);
    }),
  );

/** Pairs with the server at the first of `urls` that answers; its origin. */
export const pairWithServer = (urls: ReadonlyArray<string>, code: string, name: string): Promise<string> =>
  runApp(
    Effect.gen(function* () {
      return yield* (yield* ServerAuth).pair(urls, code, name);
    }),
  );

/** Forgets a paired server (its token and its place in the list). */
export const forgetServer = (origin: string): Promise<void> =>
  runApp(
    Effect.gen(function* () {
      yield* (yield* ServerAuth).forget(origin);
    }),
  );
