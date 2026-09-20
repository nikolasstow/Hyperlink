/**
 * Two-tier cache for tokenized code, so highlighting is paid for once: an
 * in-memory map (instant within a session — reopening a file, re-rendering on
 * scroll) backed by AsyncStorage (survives app restarts). Keyed by a hash of
 * the code plus the language and theme, so a change to any of them is a miss.
 *
 * Fast scrolling never re-tokenizes: the highlighted lines are computed once and
 * read from here, so a virtualized list just renders cached tokens.
 *
 * @internal
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { HighlightResult } from "./shikiHighlighter";

/** Bump when the stored shape changes, to invalidate old entries. */
const CACHE_VERSION = "v1";
const KEY_PREFIX = `shiki:${CACHE_VERSION}:`;
/** Cap the in-memory tier; oldest entries evicted first. */
const MEMORY_LIMIT = 80;

/** FNV-1a — fast, non-crypto; collisions don't matter (worst case: a re-tokenize). */
const hash = (input: string): string => {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
};

export const cacheKey = (code: string, lang: string, themeName: string): string =>
  `${KEY_PREFIX}${themeName}:${lang}:${code.length}:${hash(code)}`;

const memory = new Map<string, HighlightResult>();

const touch = (key: string, value: HighlightResult): void => {
  // Re-insert to mark most-recently-used; evict oldest past the cap.
  memory.delete(key);
  memory.set(key, value);
  if (memory.size > MEMORY_LIMIT) {
    const oldest = memory.keys().next().value;
    if (oldest !== undefined) memory.delete(oldest);
  }
};

/** Look up a cached result: memory first, then AsyncStorage (promoting hits). */
export const getCachedTokens = async (key: string): Promise<HighlightResult | undefined> => {
  const inMemory = memory.get(key);
  if (inMemory !== undefined) {
    touch(key, inMemory);
    return inMemory;
  }
  try {
    const raw = await AsyncStorage.getItem(key);
    if (raw === null) return undefined;
    const parsed: HighlightResult = JSON.parse(raw);
    touch(key, parsed);
    return parsed;
  } catch {
    return undefined;
  }
};

/** Store a result in both tiers (persistence is best-effort). */
export const setCachedTokens = (key: string, value: HighlightResult): void => {
  touch(key, value);
  void AsyncStorage.setItem(key, JSON.stringify(value)).catch(() => undefined);
};
