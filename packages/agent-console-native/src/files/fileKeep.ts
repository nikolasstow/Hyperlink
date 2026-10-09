/**
 * Files the user chose to **Keep On Device**: pinned for offline — their text is
 * fetched and kept in the device cache (fileTextCache) so they're always
 * available without a network, and warmed into memory at launch so they open
 * instantly. A persisted set of absolute paths, reactive for the UI.
 *
 * @internal
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as React from "react";

const KEY_PREFIX = "filekeep:v1:";

const kept = new Set<string>();
let snap: ReadonlySet<string> = new Set();
const listeners = new Set<() => void>();
const notify = (): void => {
  snap = new Set(kept);
  listeners.forEach((listener) => listener());
};

export const isKeptSync = (path: string): boolean => kept.has(path);

/** Every path kept on device now. */
export const keptPathsNow = (): ReadonlySet<string> => snap;

/** The kept paths, for React (re-renders when one changes). */
export const useKeptPaths = (): ReadonlySet<string> =>
  React.useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => snap,
  );

/** Pin a file to the device (the caller also downloads its text). */
export const keepOnDevice = (path: string): void => {
  if (kept.has(path)) return;
  kept.add(path);
  notify();
  void AsyncStorage.setItem(`${KEY_PREFIX}${path}`, "1").catch(() => undefined);
};

/** Unpin a file (its cached copy may be evicted later as usual). */
export const removeFromDevice = (path: string): void => {
  if (!kept.has(path)) return;
  kept.delete(path);
  notify();
  void AsyncStorage.removeItem(`${KEY_PREFIX}${path}`).catch(() => undefined);
};

/** Read back the kept set at launch. */
export const loadKept = async (): Promise<void> => {
  try {
    const keys = await AsyncStorage.getAllKeys();
    for (const key of keys) if (key.startsWith(KEY_PREFIX)) kept.add(key.slice(KEY_PREFIX.length));
    notify();
  } catch {
    // Best-effort — the pins just won't be known until re-set.
  }
};
