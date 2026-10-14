/**
 * The model catalog for React (ModelCatalog.ts): `startModelCatalog` (once,
 * at launch) reads the kept catalogs back; `ModelCatalogSync` (in the app,
 * where the server is known) fetches them again at open and on return to the
 * foreground; `useCatalog` gives a folder's catalog, or the server's own
 * while that folder's has never loaded.
 *
 * @internal
 */
import { Effect, Stream } from "effect";
import * as React from "react";
import { AppState } from "react-native";
import { useAppContext } from "../AppContext";
import { forkApp, runApp } from "../effect/runtime";
import { type Catalog, folderKey, ModelCatalog } from "./ModelCatalog";

let catalogs: Readonly<Record<string, Catalog>> = {};
let server: string | undefined;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

let started = false;
let readBack: () => void = () => undefined;
/** Settles once the kept catalogs are read back (the app waits for it). */
export const modelCatalogReadBack = new Promise<void>((resolve) => {
  readBack = resolve;
});

/** Reads the kept catalogs back and mirrors them for React (once). */
export const startModelCatalog = (): void => {
  if (started) return;
  started = true;
  forkApp(
    Effect.gen(function* () {
      const catalog = yield* ModelCatalog;
      yield* catalog.readBack;
      yield* Effect.sync(readBack);
      return catalog.changes;
    }).pipe(
      Stream.unwrap,
      Stream.runForEach((next) =>
        Effect.sync(() => {
          catalogs = next;
          listeners.forEach((listener) => listener());
        }),
      ),
    ),
  );
};

/** A folder's catalog now: its own, else the server's own, else none. */
export const catalogNow = (directory: string | undefined): Catalog | undefined => catalogs[folderKey(directory)] ?? catalogs[folderKey(undefined)];

/** A folder's catalog, as it changes (the server's own until the folder's loads). */
export const useCatalog = (directory: string | undefined): Catalog | undefined => React.useSyncExternalStore(subscribe, () => catalogNow(directory));

/** Fetches one folder's catalog again (a folder seen for the first time). */
export const refreshCatalog = (directory: string | undefined): Promise<void> =>
  server === undefined
    ? Promise.resolve()
    : runApp(
        Effect.gen(function* () {
          yield* (yield* ModelCatalog).refresh(server ?? "", directory);
        }),
      );

/** Whether a folder's own catalog has loaded (else it shows the server's own). */
export const hasOwnCatalog = (directory: string | undefined): boolean => catalogs[folderKey(directory)]?.complete === true;

/** Fetches every known catalog at open and on return to the foreground. Mounted once. */
export const ModelCatalogSync = (): null => {
  const context = useAppContext();
  React.useEffect(() => {
    server = context.server;
    const sync = () =>
      void runApp(
        Effect.gen(function* () {
          yield* (yield* ModelCatalog).refreshAll(context.server);
        }),
      );
    sync();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") sync();
    });
    return () => subscription.remove();
  }, [context.server]);
  return null;
};
