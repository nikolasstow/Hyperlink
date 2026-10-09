/**
 * The last-known text of a file, cached on the device so opening it is instant:
 * an in-memory map (synchronous, for the first frame) backed by AsyncStorage
 * (survives restarts). Keyed by absolute path.
 *
 * Stale-while-revalidate: a view shows the cached text at once, then re-reads
 * `/fs/read` in the background and updates if it changed. Saves update the cache
 * too, so an edited file reopens to its edited text with no fetch.
 *
 * @internal
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

const CACHE_VERSION = "v1";
const KEY_PREFIX = `filetext:${CACHE_VERSION}:`;
/** Cap the in-memory tier; oldest evicted first. */
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

/** The cached text in memory, synchronously (undefined on a memory miss even if
 * AsyncStorage has it — warm memory via `getFileText`/preload first). */
export const getFileTextSync = (path: string): string | undefined => {
  const inMemory = memory.get(path);
  if (inMemory === undefined) return undefined;
  touch(path, inMemory);
  return inMemory;
};

/** The cached text: memory first, then AsyncStorage (promoting hits to memory). */
export const getFileText = async (path: string): Promise<string | undefined> => {
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

/** Store a file's text in both tiers (persistence is best-effort). */
export const setFileText = (path: string, text: string): void => {
  touch(path, text);
  void AsyncStorage.setItem(`${KEY_PREFIX}${path}`, text).catch(() => undefined);
};
