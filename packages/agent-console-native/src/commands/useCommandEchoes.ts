/**
 * Command echoes for React (CommandEchoes.ts): `startCommandEchoes` (once, at
 * launch) reads them back; `useCommandEchoes` gives them as they change.
 *
 * @internal
 */
import { Effect, Stream } from "effect";
import * as React from "react";
import { forkApp } from "../effect/runtime";
import { CommandEchoes, type Echo } from "./CommandEchoes";

const NONE: Readonly<Record<string, Echo>> = {};
let echoes: Readonly<Record<string, Echo>> = NONE;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

let started = false;
let readBack: () => void = () => undefined;
/** Settles once the kept echoes are read back (the app waits for it). */
export const commandEchoesReadBack = new Promise<void>((resolve) => {
  readBack = resolve;
});

/** Reads the kept echoes back and mirrors them for React (once). */
export const startCommandEchoes = (): void => {
  if (started) return;
  started = true;
  forkApp(
    Effect.gen(function* () {
      const kept = yield* CommandEchoes;
      yield* kept.readBack;
      yield* Effect.sync(readBack);
      return kept.changes;
    }).pipe(
      Stream.unwrap,
      Stream.runForEach((next) =>
        Effect.sync(() => {
          echoes = next;
          listeners.forEach((listener) => listener());
        }),
      ),
    ),
  );
};

/** What command messages were typed as, by message id. */
export const useCommandEchoes = (): Readonly<Record<string, Echo>> => React.useSyncExternalStore(subscribe, () => echoes);
