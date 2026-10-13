import { Effect, Option, Stream } from "effect";
import { KeyValueStore } from "effect/unstable/persistence";
import { describe, expect, it } from "vitest";
import type { BarWindowState } from "./barWindowGeometry";
import { BarWindowStore } from "./BarWindowStore";

const stateA: BarWindowState = { open: true, frac: 0, kbFull: 300, keyboard: 300 };
const stateB: BarWindowState = { open: false, frac: 1, kbFull: 0, keyboard: 0 };

const run = <A, E>(effect: Effect.Effect<A, E, BarWindowStore>): Promise<A> =>
  Effect.runPromise(effect.pipe(Effect.provide(BarWindowStore.layer), Effect.provide(KeyValueStore.layerMemory)));

describe("BarWindowStore", () => {
  it("keys each screen's state by route", async () => {
    const map = await run(
      Effect.gen(function* () {
        const store = yield* BarWindowStore;
        yield* store.settle("a", stateA);
        yield* store.settle("b", stateB);
        return yield* Stream.runHead(store.changes).pipe(Effect.map(Option.getOrThrow));
      }),
    );
    expect(map.get("a")).toEqual(stateA);
    expect(map.get("b")).toEqual(stateB);
    expect(map.size).toBe(2);
  });

  it("forget removes just that route", async () => {
    const map = await run(
      Effect.gen(function* () {
        const store = yield* BarWindowStore;
        yield* store.settle("a", stateA);
        yield* store.settle("b", stateB);
        yield* store.forget("a");
        return yield* Stream.runHead(store.changes).pipe(Effect.map(Option.getOrThrow));
      }),
    );
    expect(map.has("a")).toBe(false);
    expect(map.get("b")).toEqual(stateB);
  });

  it("detent round-trips through the KeyValueStore", async () => {
    const detent = await run(
      Effect.gen(function* () {
        const store = yield* BarWindowStore;
        yield* store.detent.set({ frac: 0.5, kbFull: 336 });
        return yield* store.detent.get;
      }),
    );
    expect(detent).toEqual({ frac: 0.5, kbFull: 336 });
  });

  it("detent is undefined before anything is saved", async () => {
    const detent = await run(
      Effect.gen(function* () {
        const store = yield* BarWindowStore;
        return yield* store.detent.get;
      }),
    );
    expect(detent).toBeUndefined();
  });
});
