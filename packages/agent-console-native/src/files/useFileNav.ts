/**
 * Files' place per repo for React (FileNav.ts): a snapshot mirrored from the
 * store, read through `useSyncExternalStore`. `startFileNav` (once, at
 * launch) reads back what was kept.
 *
 * @internal
 */
import { Effect, HashMap, Option, Stream } from "effect";
import * as React from "react";
import { forkApp, runApp } from "../effect/runtime";
import { FileNav, type FileNavEntry, fileNavChanges, type FilePlace } from "./FileNav";

let places: HashMap.HashMap<string, FilePlace> = HashMap.empty();
const listeners = new Set<() => void>();
const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

let started = false;

/** Reads back the kept places and mirrors them for React (once). */
export const startFileNav = (): void => {
  if (started) return;
  started = true;
  forkApp(
    fileNavChanges.pipe(
      Stream.runForEach((next) =>
        Effect.sync(() => {
          places = next;
          listeners.forEach((listener) => listener());
        }),
      ),
    ),
  );
};

/** Every repo's place in Files, by repo. */
export const useFilePlaces = (): HashMap.HashMap<string, FilePlace> => React.useSyncExternalStore(subscribe, () => places);

/** A repo's place in Files (its tabs), or undefined before it has one. */
export const useFileNav = (repo: string): FilePlace | undefined =>
  React.useSyncExternalStore(subscribe, () => Option.getOrUndefined(HashMap.get(places, repo)));

const run = (name: string, f: (nav: FileNav["Service"]) => Effect.Effect<void>): void => {
  runApp(
    Effect.gen(function* () {
      const nav = yield* FileNav;
      yield* f(nav);
    }),
  ).catch((error: unknown) => console.error(`[files] ${name} failed`, error));
};

/** Starts a repo at its root (or over, at a new root). */
export const ensureFileRoot = (repo: string, root: FileNavEntry): void => run("starting at the root", (nav) => nav.ensureRoot(repo, root));
/** Opens a folder or a file in the tab showing, dropping what was ahead. */
export const openFileEntry = (repo: string, entry: FileNavEntry): void => run("opening", (nav) => nav.open(repo, entry));
export const fileBack = (repo: string): void => run("going back", (nav) => nav.back(repo));
export const fileForward = (repo: string): void => run("going forward", (nav) => nav.forward(repo));
export const selectFileTab = (repo: string, index: number): void => run("switching tabs", (nav) => nav.select(repo, index));
export const newFileTab = (repo: string, entry: FileNavEntry): void => run("opening a tab", (nav) => nav.newTab(repo, entry));
export const closeFileTab = (repo: string, index: number): void => run("closing a tab", (nav) => nav.close(repo, index));
