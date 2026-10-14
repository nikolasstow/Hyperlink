import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HighlightResult } from "./shikiHighlighter";

const stored = vi.hoisted(() => new Map<string, string>());

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (key: string) => stored.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      stored.set(key, value);
    },
    getAllKeys: async () => [...stored.keys()],
    multiRemove: async (keys: ReadonlyArray<string>) => {
      for (const key of keys) stored.delete(key);
    },
  },
}));

/** A result whose JSON is about `chars` long. */
const result = (chars: number): HighlightResult => ({
  lines: [[{ content: "x".repeat(chars), color: "#fff", italic: false, bold: false }]],
  background: "#000",
  foreground: "#fff",
});

/** Lets the cache's writes finish. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

beforeEach(() => {
  stored.clear();
  vi.resetModules();
});

describe("codeCache", () => {
  it("keeps only what it is asked to keep on the device", async () => {
    const cache = await import("./codeCache");
    const opened = cache.cacheKey("opened", "ts", "dark");
    const typed = cache.cacheKey("typed", "ts", "dark");
    cache.setCachedTokens(opened, result(10), true);
    cache.setCachedTokens(typed, result(10), false);
    await settle();
    expect(stored.has(opened)).toBe(true);
    expect(stored.has(typed)).toBe(false);
    expect(cache.getCachedTokensSync(typed)).toBeDefined();
  });

  it("lets the oldest kept results go past the cap", async () => {
    const cache = await import("./codeCache");
    const keys = ["a", "b", "c", "d"].map((code) => cache.cacheKey(code, "ts", "dark"));
    for (const key of keys) {
      cache.setCachedTokens(key, result(5_500_000), true);
      await settle();
    }
    expect(keys.map((key) => stored.has(key))).toEqual([false, true, true, true]);
  });

  it("does not keep a result too large to keep", async () => {
    const cache = await import("./codeCache");
    const key = cache.cacheKey("huge", "ts", "dark");
    cache.setCachedTokens(key, result(7_000_000), true);
    await settle();
    expect(stored.has(key)).toBe(false);
  });

  it("lets go of results kept by builds before the index", async () => {
    stored.set("shiki:v1:dark:ts:3:abc", "{}");
    const cache = await import("./codeCache");
    const key = cache.cacheKey("new", "ts", "dark");
    cache.setCachedTokens(key, result(10), true);
    await settle();
    expect(stored.has("shiki:v1:dark:ts:3:abc")).toBe(false);
    expect(stored.has(key)).toBe(true);
  });

  it("reads a kept result back in a new run", async () => {
    const first = await import("./codeCache");
    const key = first.cacheKey("kept", "ts", "dark");
    first.setCachedTokens(key, result(10), true);
    await settle();
    vi.resetModules();
    const second = await import("./codeCache");
    expect(await second.getCachedTokens(key)).toEqual(result(10));
  });
});
