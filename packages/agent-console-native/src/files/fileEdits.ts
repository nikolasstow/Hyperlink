/**
 * Pending offline edits to a file — the **local (temporary) save**: the edited
 * text that hasn't been written to disk yet, kept on the device so it survives a
 * restart and is shown offline-first (before any `/fs/read`). Distinct from
 * fileTextCache, which holds the last-known *disk* text.
 *
 * In-memory map (synchronous, for the first frame) backed by AsyncStorage.
 * Keyed by absolute path. A permanent (cloud) save clears the pending edit once
 * disk matches it.
 *
 * @internal
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as React from "react";

const CACHE_VERSION = "v1";
const KEY_PREFIX = `fileedit:${CACHE_VERSION}:`;
const MEMORY_LIMIT = 60;

const memory = new Map<string, string>();

// The set of paths with a pending (unsaved-to-disk) edit — for the folder view's
// "has local changes" indicator. Kept as an immutable snapshot for React.
const dirty = new Set<string>();
let dirtySnap: ReadonlySet<string> = new Set();
const dirtyListeners = new Set<() => void>();
const notifyDirty = (): void => {
  dirtySnap = new Set(dirty);
  dirtyListeners.forEach((listener) => listener());
};
const markDirty = (path: string, is: boolean): void => {
  if (is ? dirty.has(path) : !dirty.has(path)) return;
  if (is) dirty.add(path);
  else dirty.delete(path);
  notifyDirty();
};

/** The paths with pending edits, for React (re-renders when one changes). */
export const useDirtyPaths = (): ReadonlySet<string> =>
  React.useSyncExternalStore(
    (listener) => {
      dirtyListeners.add(listener);
      return () => dirtyListeners.delete(listener);
    },
    () => dirtySnap,
  );

/** Load persisted pending edits into the dirty set at launch, so the folder
 * view shows local changes made before a restart. */
export const loadDirtyEdits = async (): Promise<void> => {
  try {
    const keys = await AsyncStorage.getAllKeys();
    for (const key of keys) if (key.startsWith(KEY_PREFIX)) dirty.add(key.slice(KEY_PREFIX.length));
    notifyDirty();
  } catch {
    // Best-effort — the indicators just won't show until a file is opened.
  }
};

const touch = (path: string, text: string): void => {
  memory.delete(path);
  memory.set(path, text);
  if (memory.size > MEMORY_LIMIT) {
    const oldest = memory.keys().next().value;
    if (oldest !== undefined) memory.delete(oldest);
  }
};

/** The pending edit in memory, synchronously (undefined on a memory miss even
 * if AsyncStorage has it — `getFileEdit` promotes it). */
export const getFileEditSync = (path: string): string | undefined => {
  const inMemory = memory.get(path);
  if (inMemory === undefined) return undefined;
  touch(path, inMemory);
  return inMemory;
};

/** The pending edit: memory first, then AsyncStorage (promoting hits). */
export const getFileEdit = async (path: string): Promise<string | undefined> => {
  const inMemory = memory.get(path);
  if (inMemory !== undefined) {
    touch(path, inMemory);
    return inMemory;
  }
  try {
    const raw = await AsyncStorage.getItem(`${KEY_PREFIX}${path}`);
    if (raw === null) return undefined;
    touch(path, raw);
    return raw;
  } catch {
    return undefined;
  }
};

/** Record a local (offline) save of `text` for `path` — both tiers. */
export const setFileEdit = (path: string, text: string): void => {
  touch(path, text);
  markDirty(path, true);
  void AsyncStorage.setItem(`${KEY_PREFIX}${path}`, text).catch(() => undefined);
};

/** Drop the pending edit (disk now matches it — a permanent save landed, or it
 * was reverted). */
export const clearFileEdit = (path: string): void => {
  memory.delete(path);
  markDirty(path, false);
  void AsyncStorage.removeItem(`${KEY_PREFIX}${path}`).catch(() => undefined);
};
