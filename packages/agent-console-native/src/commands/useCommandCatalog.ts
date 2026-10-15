/**
 * The `/` lists for React (CommandCatalog.ts): `startCommandCatalog` (once, at
 * launch) reads the kept lists back; `CommandCatalogSync` (in the app, where
 * the server is known) fetches them again at open and on return to the
 * foreground, and follows opencode's events while the app is in front;
 * `useCommands` gives a folder's list.
 *
 * @internal
 */
import type { Commands } from "agent-console-protocol";
import { Effect, Fiber, Stream } from "effect";
import * as React from "react";
import { AppState } from "react-native";
import { useAppContext } from "../AppContext";
import { forkApp, runApp } from "../effect/runtime";
import { serverAddressOf } from "../opencode/serverAddress";
import { CommandCatalog, folderKey } from "./CommandCatalog";

const NONE: ReadonlyArray<Commands.Entry> = [];

let lists: Readonly<Record<string, ReadonlyArray<Commands.Entry>>> = {};
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
/** Settles once the kept lists are read back (the app waits for it). */
export const commandCatalogReadBack = new Promise<void>((resolve) => {
  readBack = resolve;
});

/** Reads the kept lists back and mirrors them for React (once). */
export const startCommandCatalog = (): void => {
  if (started) return;
  started = true;
  forkApp(
    Effect.gen(function* () {
      const catalog = yield* CommandCatalog;
      yield* catalog.readBack;
      yield* Effect.sync(readBack);
      return catalog.changes;
    }).pipe(
      Stream.unwrap,
      Stream.runForEach((next) =>
        Effect.sync(() => {
          lists = next;
          listeners.forEach((listener) => listener());
        }),
      ),
    ),
  );
};

/** A folder's list now: its own, else the server's own, else none. */
const commandsNow = (directory: string | undefined): ReadonlyArray<Commands.Entry> => lists[folderKey(directory)] ?? lists[folderKey(undefined)] ?? NONE;

/** A folder's list, as it changes (the server's own until the folder's loads). */
export const useCommands = (directory: string | undefined): ReadonlyArray<Commands.Entry> =>
  React.useSyncExternalStore(subscribe, () => commandsNow(directory));

/** Fetches a folder's list when it has none yet (a folder seen for the first
 * time), so it is there before `/` is typed. */
export const useLoadCommands = (directory: string | undefined): void => {
  React.useEffect(() => {
    if (server === undefined || folderKey(directory) in lists) return;
    const from = server;
    void runApp(
      Effect.gen(function* () {
        yield* (yield* CommandCatalog).refresh(from, directory);
      }),
    );
  }, [directory]);
};

/** Fetches every known list at open and on return to the foreground, and
 * follows opencode's events while the app is in front. Mounted once. */
export const CommandCatalogSync = (): null => {
  const context = useAppContext();
  React.useEffect(() => {
    server = context.server;
    const opencodeServer = serverAddressOf(context.address);
    let following: Fiber.Fiber<unknown> | undefined;
    const start = () => {
      void runApp(
        Effect.gen(function* () {
          yield* (yield* CommandCatalog).refreshAll(context.server);
        }),
      );
      following ??= forkApp(
        Effect.gen(function* () {
          yield* (yield* CommandCatalog).follow(context.server, opencodeServer);
        }),
      );
    };
    const stop = () => {
      if (following !== undefined) void runApp(Fiber.interrupt(following));
      following = undefined;
    };
    start();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") start();
      else if (state === "background") stop();
    });
    return () => {
      subscription.remove();
      stop();
    };
  }, [context.server, context.address]);
  return null;
};
