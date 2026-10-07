/**
 * The files and folders found not to be there (a tab's, in a worktree
 * without it), as their previews read them: the tab view shows those tabs
 * disabled until they are found (a worktree switched to that has them). Kept
 * in memory; each preview's read keeps it current.
 *
 * @internal
 */
import * as React from "react";

let missing: ReadonlySet<string> = new Set();
const listeners = new Set<() => void>();
const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** A path read: there or not. */
export const notePath = (path: string, found: boolean): void => {
  if (missing.has(path) !== found) return;
  const next = new Set(missing);
  if (found) next.delete(path);
  else next.add(path);
  missing = next;
  listeners.forEach((listener) => listener());
};

/** The paths found not to be there. */
export const useMissingPaths = (): ReadonlySet<string> => React.useSyncExternalStore(subscribe, () => missing);
