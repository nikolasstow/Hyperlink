import { Effect, Stream } from "effect";
import * as KeyValueStore from "effect/persistence/KeyValueStore";
import { describe, expect, it } from "vitest";
import { FileScrolls } from "./FileScrolls";

const current = Effect.gen(function* () {
  return yield* (yield* FileScrolls).changes.pipe(Stream.take(1), Stream.runCollect);
});

describe("FileScrolls", () => {
  it("keeps where each file came to rest, the latest winning", async () => {
    const scrolls = await Effect.runPromise(
      Effect.gen(function* () {
        const files = yield* FileScrolls;
        yield* files.keep("/a.ts", { x: 0, y: 120 });
        yield* files.keep("/b.ts", { x: 16, y: 40 });
        yield* files.keep("/a.ts", { x: 0, y: 300 });
        return yield* current;
      }).pipe(Effect.provide(FileScrolls.layer), Effect.provide(KeyValueStore.layerMemory)),
    );
    expect(scrolls[0]).toEqual({ "/a.ts": { x: 0, y: 300 }, "/b.ts": { x: 16, y: 40 } });
  });

  it("reads them back in a new run", async () => {
    const scrolls = await Effect.runPromise(
      Effect.gen(function* () {
        yield* Effect.gen(function* () {
          yield* (yield* FileScrolls).keep("/a.ts", { x: 0, y: 120 });
        }).pipe(Effect.provide(FileScrolls.layer));
        return yield* current.pipe(Effect.provide(FileScrolls.layer));
      }).pipe(Effect.provide(KeyValueStore.layerMemory)),
    );
    expect(scrolls[0]).toEqual({ "/a.ts": { x: 0, y: 120 } });
  });
});
