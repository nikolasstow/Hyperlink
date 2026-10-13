/**
 * The custom code fonts for React (CodeFonts.ts): `startCodeFonts` (once, at
 * launch) registers the fonts kept on the device and mirrors what is
 * installed; `syncCodeFonts` brings them in step with the server's list
 * (at launch, on foreground, and after the list changes).
 *
 * @internal
 */
import { Effect, Stream } from "effect";
import * as React from "react";
import { forkApp, runApp } from "../effect/runtime";
import { getCustomFonts } from "../fontsClient";
import { CodeFonts } from "./CodeFonts";

/** Installed family → the file it is in. */
let installed: ReadonlyMap<string, string> = new Map();
const listeners = new Set<() => void>();
const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

let started = false;
let readBack: () => void = () => undefined;
/** Settles once the kept fonts are registered (the app waits for it, so the
 * first file opened is drawn in its font). */
export const codeFontsReadBack = new Promise<void>((resolve) => {
  readBack = resolve;
});

/** Registers the kept fonts and mirrors what is installed (once). */
export const startCodeFonts = (): void => {
  if (started) return;
  started = true;
  forkApp(
    Effect.gen(function* () {
      const fonts = yield* CodeFonts;
      yield* fonts.readBack.pipe(Effect.ensuring(Effect.sync(() => readBack())));
      yield* fonts.changes.pipe(
        Stream.runForEach((next) =>
          Effect.sync(() => {
            installed = next;
            listeners.forEach((listener) => listener());
          }),
        ),
      );
    }),
  );
};

/** The installed custom fonts: family → file. */
export const useInstalledCodeFonts = (): ReadonlyMap<string, string> => React.useSyncExternalStore(subscribe, () => installed);

/** Installs what the API server lists and removes what it no longer does. */
export const syncCodeFonts = (server: string): Promise<void> =>
  getCustomFonts(server).then((fonts) =>
    runApp(
      Effect.gen(function* () {
        yield* (yield* CodeFonts).sync(server, fonts);
      }),
    ),
  );
