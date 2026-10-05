import { Effect, HashMap, Layer, Option, Stream } from "effect";
import { KeyValueStore } from "effect/unstable/persistence";
import { describe, expect, it } from "vitest";
import { canGoBack, canGoForward, currentEntry, FileNav, type FileNavEntry, opened } from "./FileNav";

const dir = (path: string): FileNavEntry => ({ path, name: path.split("/").pop() ?? path, kind: "directory" });
const file = (path: string): FileNavEntry => ({ path, name: path.split("/").pop() ?? path, kind: "file" });

const deviceStorage = () => {
  const stored = new Map<string, string>();
  return Layer.succeed(KeyValueStore.KeyValueStore)(
    KeyValueStore.makeStringOnly({
      get: (key) => Effect.sync(() => stored.get(key)),
      set: (key, value) => Effect.sync(() => void stored.set(key, value)),
      remove: (key) => Effect.sync(() => void stored.delete(key)),
      clear: Effect.sync(() => stored.clear()),
      size: Effect.sync(() => stored.size),
    }),
  );
};

const run = <A, E>(program: Effect.Effect<A, E, FileNav>, storage: ReturnType<typeof deviceStorage>) =>
  Effect.runPromise(program.pipe(Effect.provide(FileNav.layer.pipe(Layer.provide(storage))), Effect.scoped));

const placeOf = (nav: FileNav["Service"], repo: string) =>
  nav.changes.pipe(
    Stream.take(1),
    Stream.runHead,
    Effect.map((all) => Option.getOrUndefined(HashMap.get(Option.getOrThrow(all), repo))),
  );

describe("opened", () => {
  it("opens after the current entry and drops what was ahead, as a browser does", () => {
    const start = { entries: [dir("/r"), dir("/r/a"), dir("/r/a/b")], index: 1 };
    const next = opened(start, file("/r/a/x.ts"));
    expect(next.entries.map((entry) => entry.path)).toEqual(["/r", "/r/a", "/r/a/x.ts"]);
    expect(currentEntry(next)?.path).toBe("/r/a/x.ts");
    expect(canGoForward(next)).toBe(false);
    expect(canGoBack(next)).toBe(true);
  });

  it("is no step to open what is showing", () => {
    const start = { entries: [dir("/r")], index: 0 };
    expect(opened(start, dir("/r"))).toBe(start);
  });
});

describe("FileNav", () => {
  it("walks back and forward, keeps each repo's place, and starts over at a new root", async () => {
    const storage = deviceStorage();
    const place = await run(
      Effect.gen(function* () {
        const nav = yield* FileNav;
        yield* nav.ensureRoot("app", dir("/r"));
        yield* nav.open("app", dir("/r/src"));
        yield* nav.open("app", file("/r/src/main.ts"));
        yield* nav.back("app");
        yield* nav.back("app");
        yield* nav.forward("app");
        // Same root again: the place is kept.
        yield* nav.ensureRoot("app", dir("/r"));
        return yield* placeOf(nav, "app");
      }),
      storage,
    );
    expect(place === undefined ? undefined : currentEntry(place)?.path).toBe("/r/src");
    expect(place?.entries.length).toBe(3);

    // Read back after a relaunch, then a new root (another worktree).
    const after = await run(
      Effect.gen(function* () {
        const nav = yield* FileNav;
        const kept = yield* placeOf(nav, "app");
        yield* nav.ensureRoot("app", dir("/other"));
        return [kept, yield* placeOf(nav, "app")];
      }),
      storage,
    );
    expect(after[0] === undefined ? undefined : currentEntry(after[0])?.path).toBe("/r/src");
    expect(after[1]?.entries.map((entry) => entry.path)).toEqual(["/other"]);
  });
});
