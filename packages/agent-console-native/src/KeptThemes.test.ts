import { Effect } from "effect";
import * as KeyValueStore from "effect/persistence/KeyValueStore";
import { describe, expect, it } from "vitest";
import { KeptThemes } from "./KeptThemes";

const run = <A, E>(effect: Effect.Effect<A, E, KeptThemes>): Promise<A> =>
  Effect.runPromise(effect.pipe(Effect.provide(KeptThemes.layer), Effect.provide(KeyValueStore.layerMemory)));

const light = {
  name: "Light",
  type: "light",
  colors: { "editor.background": "#FFFFFF" },
  tokenColors: [{ scope: "comment", settings: { foreground: "#008000" } }],
};
const dark = {
  name: "Dark",
  type: "dark",
  colors: { "editor.background": "#1E1E1E" },
};

describe("KeptThemes", () => {
  it("starts with none", async () => {
    expect(await run(Effect.gen(function* () {
      return yield* (yield* KeptThemes).all;
    }))).toEqual({});
  });

  it("keeps each theme by file, and a newer copy replaces the older", async () => {
    const all = await run(
      Effect.gen(function* () {
        const kept = yield* KeptThemes;
        yield* kept.keep("a.json", dark);
        yield* kept.keep("b.json", light);
        yield* kept.keep("a.json", { ...dark, name: "Dark 2" });
        return yield* kept.all;
      }),
    );
    expect(all).toEqual({
      "a.json": { ...dark, name: "Dark 2" },
      "b.json": light,
    });
  });
});
