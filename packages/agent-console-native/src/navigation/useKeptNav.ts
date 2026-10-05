/**
 * The kept pages for React (KeptNav.ts): `startKeptNav` (once, at launch)
 * reads them back; the root navigator opens on them and keeps its own.
 *
 * @internal
 */
import { Effect, Stream } from "effect";
import * as React from "react";
import { forkApp, runApp } from "../effect/runtime";
import { KeptNav, keptNavChanges } from "./KeptNav";
import { type KeptPages, keptPagesOf, type PageRoute } from "./keptPages";

/** Undefined until read back (the launch waits for it). */
let pages: KeptPages | undefined;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

let started = false;
let readBack: () => void = () => undefined;
/** Settles once the kept pages have been read back. */
export const keptNavReadBack = new Promise<void>((resolve) => {
  readBack = resolve;
});

/** Reads back the kept pages and mirrors them for React (once). */
export const startKeptNav = (): void => {
  if (started) return;
  started = true;
  forkApp(
    keptNavChanges.pipe(
      Stream.runForEach((next) =>
        Effect.sync(() => {
          pages = next;
          readBack();
          listeners.forEach((listener) => listener());
        }),
      ),
    ),
  );
};

/** The kept pages now (for the navigator's first frame); undefined until
 * read back. */
export const keptNavNow = (): KeptPages | undefined => pages;

/** The kept pages; undefined until read back. */
export const useKeptNav = (): KeptPages | undefined => React.useSyncExternalStore(subscribe, () => pages);

/** Keeps the pages open now. */
export const keepNav = (routes: ReadonlyArray<PageRoute>): Promise<void> =>
  runApp(
    Effect.gen(function* () {
      const store = yield* KeptNav;
      yield* store.keep(keptPagesOf(routes));
    }),
  );
