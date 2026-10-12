/**
 * Live files for React (LiveFiles.ts): a snapshot of every followed file,
 * read through `useSyncExternalStore`, plus the calls an open editor makes
 * (typing, saving, settling a conflict) and the changes it must apply.
 *
 * `LiveFilesFollower` (mounted once, inside the app's context) decides what
 * is followed: every file open in a Files tab, every file kept on the
 * device, and every file on screen (`useOnScreen`). So an agent's edit
 * reaches a file before anyone opens it.
 *
 * @internal
 */
import { Effect, Fiber, HashMap, Option, Stream } from "effect";
import * as React from "react";
import { useAppContext } from "../AppContext";
import { forkApp, runApp } from "../effect/runtime";
import { getApiAddress } from "../settings";
import { useKeptPaths } from "./fileKeep";
import { tabEntry } from "./FileNav";
import { LiveFiles, type LiveFileProblem, type LiveFileUpdate } from "./LiveFiles";
import type * as LiveFile from "./liveFile";
import { useFilePlaces } from "./useFileNav";

let files: HashMap.HashMap<string, LiveFile.LiveFile> = HashMap.empty();
let problems: HashMap.HashMap<string, LiveFileProblem> = HashMap.empty();
const listeners = new Set<() => void>();
const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

let started = false;

/** Mirrors the followed files for React (once). */
const start = (): void => {
  if (started) return;
  started = true;
  forkApp(
    Stream.unwrap(LiveFiles.pipe(Effect.map((live) => live.changes))).pipe(
      Stream.runForEach((next) =>
        Effect.sync(() => {
          files = next;
          listeners.forEach((listener) => listener());
        }),
      ),
    ),
  );
  forkApp(
    Stream.unwrap(LiveFiles.pipe(Effect.map((live) => live.problems))).pipe(
      Stream.runForEach((next) =>
        Effect.sync(() => {
          problems = next;
          listeners.forEach((listener) => listener());
        }),
      ),
    ),
  );
};

/** Why the hub has not sent the file at `path`, if it has not. */
export const useLiveFileProblem = (path: string): LiveFileProblem | undefined =>
  React.useSyncExternalStore(subscribe, () => Option.getOrUndefined(HashMap.get(problems, path)));

/** The followed file at `path`, or undefined before the hub has sent it. */
export const useLiveFile = (path: string): LiveFile.LiveFile | undefined =>
  React.useSyncExternalStore(subscribe, () => Option.getOrUndefined(HashMap.get(files, path)));

/** The followed file at `path`, read now (outside React). */
export const liveFileNow = (path: string): LiveFile.LiveFile | undefined => Option.getOrUndefined(HashMap.get(files, path));

const run = (name: string, f: (live: LiveFiles["Service"]) => Effect.Effect<void>): void => {
  runApp(LiveFiles.pipe(Effect.flatMap(f))).catch((error: unknown) => console.error(`[live files] ${name} failed`, error));
};

/** Typing in an open editor. */
export const editLiveFile = (path: string, text: string): void => run("editing", (live) => live.edit(path, text));
/** Write a file's edits to disk, as soon as the hub allows. */
export const saveLiveFile = (path: string): void => run("saving", (live) => live.save(path));
/** Settle a conflict: keep the outside change, or put ours back. */
export const resolveLiveConflict = (path: string, index: number, keep: "Mine" | "Theirs"): void =>
  run("settling a conflict", (live) => live.resolve(path, index, keep));

/** Calls `onUpdate` with each change an open editor of `path` must apply,
 * and `onSaved` each time its edits reach the disk. */
export const useLiveFileEvents = (path: string, onUpdate: (update: LiveFile.EditorUpdate) => void, onSaved: () => void): void => {
  const latest = React.useRef({ onUpdate, onSaved });
  latest.current = { onUpdate, onSaved };
  React.useEffect(() => {
    const updates = forkApp(
      Stream.unwrap(LiveFiles.pipe(Effect.map((live) => live.updates))).pipe(
        Stream.filter((event: LiveFileUpdate) => event.path === path),
        Stream.runForEach((event) => Effect.sync(() => latest.current.onUpdate(event.update))),
      ),
    );
    const saves = forkApp(
      Stream.unwrap(LiveFiles.pipe(Effect.map((live) => live.saved))).pipe(
        Stream.filter((saved) => saved === path),
        Stream.runForEach(() => Effect.sync(() => latest.current.onSaved())),
      ),
    );
    return () => {
      forkApp(Fiber.interrupt(updates));
      forkApp(Fiber.interrupt(saves));
    };
  }, [path]);
};

// Files on screen right now, counted (two views of one file count twice).
const onScreen = new Map<string, number>();
let onScreenSnap: ReadonlySet<string> = new Set();
const onScreenListeners = new Set<() => void>();
const notifyOnScreen = (): void => {
  onScreenSnap = new Set(onScreen.keys());
  onScreenListeners.forEach((listener) => listener());
};

/** Follows `path` while the calling view is mounted. */
export const useOnScreen = (path: string): void => {
  React.useEffect(() => {
    onScreen.set(path, (onScreen.get(path) ?? 0) + 1);
    notifyOnScreen();
    return () => {
      const count = (onScreen.get(path) ?? 1) - 1;
      if (count === 0) onScreen.delete(path);
      else onScreen.set(path, count);
      notifyOnScreen();
    };
  }, [path]);
};

const useOnScreenPaths = (): ReadonlySet<string> =>
  React.useSyncExternalStore(
    (listener) => {
      onScreenListeners.add(listener);
      return () => onScreenListeners.delete(listener);
    },
    () => onScreenSnap,
  );

/** Keeps the files someone might open next followed. Mounted once. */
export const LiveFilesFollower = (): null => {
  const { address } = useAppContext();
  const places = useFilePlaces();
  const kept = useKeptPaths();
  const shown = useOnScreenPaths();
  React.useEffect(start, []);
  const paths = React.useMemo(() => {
    const all = new Set<string>([...kept, ...shown]);
    for (const place of HashMap.values(places)) {
      for (const tab of place.tabs) {
        const entry = tabEntry(tab);
        if (entry?.kind === "file") all.add(entry.path);
      }
    }
    return all;
  }, [places, kept, shown]);
  React.useEffect(() => {
    run("following", (live) => live.follow(getApiAddress(address), paths));
  }, [address, paths]);
  return null;
};
