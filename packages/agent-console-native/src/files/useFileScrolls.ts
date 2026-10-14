/**
 * Where each file was left, for React (FileScrolls.ts): `startFileScrolls`
 * (once, at launch) reads them back; the editor opens a file at
 * `scrollOffsetOf` and keeps where it comes to rest; previews follow
 * `useScrollOffset`.
 *
 * @internal
 */
import { Effect, Stream } from "effect";
import * as React from "react";
import { forkApp, runApp } from "../effect/runtime";
import { FileScrolls, type ScrollOffset } from "./FileScrolls";

let scrolls: Readonly<Record<string, ScrollOffset>> = {};
const TOP: ScrollOffset = { x: 0, y: 0 };
const listeners = new Set<() => void>();
const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

let started = false;
let readBack: () => void = () => undefined;
/** Settles once the kept positions are read back (the app waits for it). */
export const fileScrollsReadBack = new Promise<void>((resolve) => {
  readBack = resolve;
});

/** Reads back where files were left and mirrors it for React (once). */
export const startFileScrolls = (): void => {
  if (started) return;
  started = true;
  forkApp(
    Effect.gen(function* () {
      return (yield* FileScrolls).changes;
    }).pipe(
      Stream.unwrap,
      Stream.runForEach((next) =>
        Effect.sync(() => {
          scrolls = next;
          readBack();
          listeners.forEach((listener) => listener());
        }),
      ),
    ),
  );
};

/** Where a file was left (its top left when never scrolled). */
export const scrollOffsetOf = (path: string): ScrollOffset => scrolls[path] ?? TOP;

/** Where a file was left, as it changes. */
export const useScrollOffset = (path: string): ScrollOffset => React.useSyncExternalStore(subscribe, () => scrollOffsetOf(path));

/** Keeps where a file came to rest. */
export const keepScrollOffset = (path: string, offset: ScrollOffset): void => {
  runApp(
    Effect.gen(function* () {
      yield* (yield* FileScrolls).keep(path, offset);
    }),
  ).catch((error: unknown) => console.error("[files] keeping a scroll position failed", error));
};
