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

const CACHE_VERSION = "v1";
const KEY_PREFIX = `fileedit:${CACHE_VERSION}:`;
const MEMORY_LIMIT = 60;

const memory = new Map<string, string>();

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
  void AsyncStorage.setItem(`${KEY_PREFIX}${path}`, text).catch(() => undefined);
};

/** Drop the pending edit (disk now matches it — a permanent save landed, or it
 * was reverted). */
export const clearFileEdit = (path: string): void => {
  memory.delete(path);
  void AsyncStorage.removeItem(`${KEY_PREFIX}${path}`).catch(() => undefined);
};
