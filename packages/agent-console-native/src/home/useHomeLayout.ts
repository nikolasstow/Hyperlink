/**
 * Home's kept layout for React (HomeLayoutStore.ts): `startHomeLayout` (once,
 * at launch) reads it back; the launch screen draws it; Home keeps its own.
 *
 * @internal
 */
import { Effect, Stream } from "effect";
import * as React from "react";
import { forkApp, runApp } from "../effect/runtime";
import type { HomeLayout } from "./homeLayout";
import { homeLayoutChanges, HomeLayoutStore } from "./HomeLayoutStore";

/** Undefined until read back (the launch screen waits for it). */
let layout: HomeLayout | undefined;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

let started = false;

/** Reads back the kept layout and mirrors it for React (once). */
export const startHomeLayout = (): void => {
  if (started) return;
  started = true;
  forkApp(
    homeLayoutChanges.pipe(
      Stream.runForEach((next) =>
        Effect.sync(() => {
          layout = next;
          listeners.forEach((listener) => listener());
        }),
      ),
    ),
  );
};

/** Home's kept layout; undefined until it is read back. */
export const useKeptHomeLayout = (): HomeLayout | undefined => React.useSyncExternalStore(subscribe, () => layout);

/** Keeps Home's layout as it is now. */
export const keepHomeLayout = (next: HomeLayout): Promise<void> =>
  runApp(
    Effect.gen(function* () {
      const store = yield* HomeLayoutStore;
      yield* store.keep(next);
    }),
  );
