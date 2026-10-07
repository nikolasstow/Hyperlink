import { Effect, HashMap, Layer, Option, Stream } from "effect";
import { KeyValueStore } from "effect/unstable/persistence";
import { describe, expect, it } from "vitest";
import { activeTab, canGoBack, canGoForward, FileNav, type FileNavEntry, type FilePlace, type FileTab, opened, rerooted, tabEntry } from "./FileNav";

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

const showing = (place: FilePlace | undefined): string | undefined => {
  const tab = place === undefined ? undefined : activeTab(place);
  return tab === undefined ? undefined : tabEntry(tab)?.path;
};

describe("opened", () => {
  it("opens after the current entry and drops what was ahead, as a browser does", () => {
    const start: FileTab = { id: "t", entries: [dir("/r"), dir("/r/a"), dir("/r/a/b")], index: 1 };
    const next = opened(start, file("/r/a/x.ts"));
    expect(next.entries.map((entry) => entry.path)).toEqual(["/r", "/r/a", "/r/a/x.ts"]);
    expect(tabEntry(next)?.path).toBe("/r/a/x.ts");
    expect(canGoForward(next)).toBe(false);
    expect(canGoBack(next)).toBe(true);
  });

  it("is no step to open what is showing", () => {
    const start: FileTab = { id: "t", entries: [dir("/r")], index: 0 };
    expect(opened(start, dir("/r"))).toBe(start);
  });
});

describe("FileNav", () => {
  it("walks back and forward in a tab, keeps each repo's place, and keeps its tabs at another root", async () => {
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
    expect(showing(place)).toBe("/r/src");
    expect(place?.history.map((visit) => visit.entry.path)).toEqual(["/r/src/main.ts", "/r/src"]);

    const after = await run(
      Effect.gen(function* () {
        const nav = yield* FileNav;
        const kept = yield* placeOf(nav, "app");
        yield* nav.ensureRoot("app", dir("/other"));
        const moved = yield* placeOf(nav, "app");
        return [kept, moved];
      }),
      storage,
    );
    expect(showing(after[0])).toBe("/r/src");
    // Another worktree: the same tabs and history, at the same files there.
    expect(after[1]?.root).toBe("/other");
    expect(after[1]?.tabs.map((tab) => tab.entries.map((entry) => entry.path))).toEqual([["/other", "/other/src", "/other/src/main.ts"]]);
    expect(after[1]?.history.map((visit) => visit.entry.path)).toEqual(["/other/src/main.ts", "/other/src"]);
  });

  it("keeps tabs apart: a new one shows, each has its own history, closing moves to a neighbour", async () => {
    const place = await run(
      Effect.gen(function* () {
        const nav = yield* FileNav;
        yield* nav.ensureRoot("app", dir("/r"));
        yield* nav.open("app", dir("/r/src"));
        yield* nav.newTab("app", file("/r/README.md"));
        const second = yield* placeOf(nav, "app");
        yield* nav.select("app", 0);
        yield* nav.back("app");
        yield* nav.close("app", 1);
        return [second, yield* placeOf(nav, "app")];
      }),
      deviceStorage(),
    );
    expect(place[0]?.active).toBe(1);
    expect(showing(place[0])).toBe("/r/README.md");
    expect(place[1]?.tabs.length).toBe(1);
    expect(showing(place[1])).toBe("/r");
  });
});

describe("rerooted", () => {
  it("moves tabs under the old root to the new one, however either is written, and leaves the rest", () => {
    const place: FilePlace = {
      root: "~/code/app",
      tabs: [
        { id: "a", entries: [dir("/Users/me/code/app"), file("/Users/me/code/app/src/x.ts")], index: 1 },
        { id: "b", entries: [file("/tmp/notes.md")], index: 0 },
      ],
      active: 0,
      history: [{ entry: file("~/code/app/README.md"), at: 1 }],
    };
    const moved = rerooted(place, dir("/Users/me/code/wt/feature"));
    expect(moved.root).toBe("/Users/me/code/wt/feature");
    expect(moved.tabs.map((tab) => tab.entries.map((entry) => entry.path))).toEqual([["/Users/me/code/wt/feature", "/Users/me/code/wt/feature/src/x.ts"], ["/tmp/notes.md"]]);
    expect(moved.tabs[0]?.entries[0]?.name).toBe("feature");
    expect(moved.history.map((visit) => visit.entry.path)).toEqual(["/Users/me/code/wt/feature/README.md"]);
  });
});
