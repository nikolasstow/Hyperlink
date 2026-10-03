/**
 * Each session's own chat background for React (SessionBackgrounds.ts): a
 * snapshot mirrored from the store, read through `useSyncExternalStore`.
 * `startSessionBackgrounds` (once, at launch) reads back what was kept.
 *
 * @internal
 */
import { Effect, HashMap, Option, Stream } from "effect";
import * as React from "react";
import { forkApp, runApp } from "../effect/runtime";
import { type BackgroundMode, type SessionBackground, sessionBackgroundChanges, SessionBackgrounds } from "./SessionBackgrounds";

let backgrounds: HashMap.HashMap<string, SessionBackground> = HashMap.empty();
const listeners = new Set<() => void>();
const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

let started = false;

/** Reads back the kept backgrounds and mirrors them for React (once). */
export const startSessionBackgrounds = (): void => {
  if (started) return;
  started = true;
  forkApp(
    sessionBackgroundChanges.pipe(
      Stream.runForEach((next) =>
        Effect.sync(() => {
          backgrounds = next;
          listeners.forEach((listener) => listener());
        }),
      ),
    ),
  );
};

/** A session's own background, or undefined when it inherits the app's. */
export const useSessionBackground = (sessionID: string): SessionBackground | undefined =>
  React.useSyncExternalStore(subscribe, () => Option.getOrUndefined(HashMap.get(backgrounds, sessionID)));

/** Sets one mode's colour for a session, or (undefined) back to the app's. */
export const setSessionBackground = (sessionID: string, mode: BackgroundMode, color: string | undefined): Promise<void> =>
  runApp(
    Effect.gen(function* () {
      const store = yield* SessionBackgrounds;
      yield* store.set(sessionID, mode, color);
    }),
  );
