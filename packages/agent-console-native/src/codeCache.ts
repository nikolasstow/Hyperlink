/**
 * Two-tier cache for tokenized code, so highlighting is paid for once: an
 * in-memory map (instant within a session — reopening a file, re-rendering on
 * scroll) backed by AsyncStorage (survives app restarts). Keyed by a hash of
 * the code plus the language and theme, so a change to any of them is a miss.
 *
 * Both tiers are capped by size, not count: one large file's tokens run to
 * megabytes. The stored tier keeps an index of what it holds (oldest first) so
 * it can let the oldest go, and only what the caller asks to keep is stored —
 * a file as opened, not each version while it is typed in.
 *
 * Fast scrolling never re-tokenizes: the highlighted lines are computed once and
 * read from here, so a virtualized list just renders cached tokens.
 *
 * @internal
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { HighlightResult } from "./shikiHighlighter";
import { textHash } from "./textHash";

/** Bump when the stored shape changes, to invalidate old entries. */
const CACHE_VERSION = "v1";
const KEY_PREFIX = `shiki:${CACHE_VERSION}:`;
/** The stored tier's list of what it holds: key and size, oldest first. */
const INDEX_KEY = `shiki-index:${CACHE_VERSION}`;
/** Cap on the in-memory tier: the code's length, summed (its tokens are
 * several times that). */
const MEMORY_CHARS = 3_000_000;
/** Cap on the stored tier: its JSON's length, summed. */
const STORED_CHARS = 20_000_000;
/** One result larger than this is kept in memory only. */
const STORED_ENTRY_CHARS = 6_000_000;

export const cacheKey = (code: string, lang: string, themeName: string): string =>
  `${KEY_PREFIX}${themeName}:${lang}:${code.length}:${textHash(code)}`;

/** The code's length, from its key. */
const sizeOf = (key: string): number => Number(key.split(":").at(-2) ?? 0);

interface Held {
  readonly value: HighlightResult;
  readonly size: number;
}

const memory = new Map<string, Held>();
let memoryChars = 0;

const touch = (key: string, value: HighlightResult): void => {
  // Re-insert to mark most-recently-used; evict oldest past the cap.
  const held = memory.get(key);
  if (held !== undefined) {
    memory.delete(key);
    memoryChars -= held.size;
  }
  const size = sizeOf(key);
  memory.set(key, { value, size });
  memoryChars += size;
  for (const [oldest, each] of memory) {
    if (memoryChars <= MEMORY_CHARS || oldest === key) break;
    memory.delete(oldest);
    memoryChars -= each.size;
  }
};

/** A synchronous, memory-only lookup (no AsyncStorage await) — so a view can
 * render already-highlighted on its first frame instead of after the async
 * tokenise. Misses in memory return undefined even if AsyncStorage has it; warm
 * the memory tier (open/preload) to make first opens instant. */
export const getCachedTokensSync = (key: string): HighlightResult | undefined => {
  const inMemory = memory.get(key)?.value;
  if (inMemory === undefined) return undefined;
  touch(key, inMemory);
  return inMemory;
};

/** Look up a cached result: memory first, then AsyncStorage (promoting hits). */
export const getCachedTokens = async (key: string): Promise<HighlightResult | undefined> => {
  const inMemory = getCachedTokensSync(key);
  if (inMemory !== undefined) return inMemory;
  if (!(await storedIndex()).has(key)) return undefined;
  try {
    const raw = await AsyncStorage.getItem(key);
    if (raw === null) return undefined;
    const parsed: HighlightResult = JSON.parse(raw);
    touch(key, parsed);
    return parsed;
  } catch (error) {
    console.error("[code cache] reading kept tokens failed", error);
    return undefined;
  }
};

/** The stored tier's index (key → JSON length, oldest first), read once. On
 * the first read, stored entries it does not list (from builds before it) are
 * let go. */
let index: Promise<Map<string, number>> | undefined;
const storedIndex = (): Promise<Map<string, number>> => {
  index ??= (async () => {
    const raw = await AsyncStorage.getItem(INDEX_KEY);
    const listed = new Map<string, number>(raw === null ? [] : JSON.parse(raw));
    const unlisted = (await AsyncStorage.getAllKeys()).filter((key) => key.startsWith("shiki:") && !listed.has(key));
    if (unlisted.length > 0) await AsyncStorage.multiRemove(unlisted);
    return listed;
  })().catch((error: unknown) => {
    console.error("[code cache] reading the kept index failed; keeping nothing this run", error);
    return new Map<string, number>();
  });
  return index;
};

/** Store one result, letting the oldest go past the cap. */
const store = async (key: string, value: HighlightResult): Promise<void> => {
  const json = JSON.stringify(value);
  if (json.length > STORED_ENTRY_CHARS) return;
  const listed = await storedIndex();
  listed.delete(key);
  listed.set(key, json.length);
  let total = 0;
  for (const size of listed.values()) total += size;
  const gone: Array<string> = [];
  for (const [oldest, size] of listed) {
    if (total <= STORED_CHARS || oldest === key) break;
    listed.delete(oldest);
    total -= size;
    gone.push(oldest);
  }
  await AsyncStorage.setItem(key, json);
  if (gone.length > 0) await AsyncStorage.multiRemove(gone);
  await AsyncStorage.setItem(INDEX_KEY, JSON.stringify([...listed]));
};

/** Cache a result in memory; with `keep`, on the device too (a file as
 * opened, not each version while typing). */
export const setCachedTokens = (key: string, value: HighlightResult, keep: boolean): void => {
  touch(key, value);
  if (!keep) return;
  store(key, value).catch((error: unknown) => console.error("[code cache] keeping tokens failed", error));
};
