/**
 * A Finder/browser-style *forward* history for the file explorer.
 *
 * A native stack keeps no forward history — popping a folder destroys it — so
 * going back then forward again would otherwise be impossible. This module
 * remembers the folders you backed out of: each explorer screen records its own
 * directory when it's popped (`pushForward`), the forward button consumes the
 * most-recent one (`popForward`), and drilling into a *new* folder abandons the
 * trail (`clearForward`), exactly as a browser drops its forward stack on a new
 * navigation.
 *
 * It's a module-level singleton (one explorer is on screen at a time) with a
 * `useSyncExternalStore` hook so the button can enable/disable reactively.
 *
 * @internal
 */
import * as React from "react";

let forward: ReadonlyArray<string> = [];
const listeners = new Set<() => void>();

const emit = (): void => {
  for (const listener of listeners) listener();
};

/** Record a folder that was just left (popped) so it can be returned to. */
export const pushForward = (dir: string): void => {
  forward = [...forward, dir];
  emit();
};

/** Take the most-recently-left folder to navigate forward into, or undefined
 * if there's nowhere forward to go. */
export const popForward = (): string | undefined => {
  const top = forward[forward.length - 1];
  if (top === undefined) return undefined;
  forward = forward.slice(0, -1);
  emit();
  return top;
};

/** Abandon the forward trail — a fresh navigation (opening the explorer, or
 * drilling into a different folder) invalidates it. */
export const clearForward = (): void => {
  if (forward.length === 0) return;
  forward = [];
  emit();
};

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** The folder the forward button would navigate into, or undefined when there
 * is no forward history. Reactive — re-renders when the trail changes. */
export const useForwardTarget = (): string | undefined =>
  React.useSyncExternalStore(subscribe, () => forward[forward.length - 1]);
