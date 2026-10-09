import { Effect, Option } from "effect";
import { KeyValueStore } from "effect/unstable/persistence";
import { describe, expect, it } from "vitest";
import { Favorites } from "./Favorites";
import { homeScope, LegacyFavorites, repoTarget, ScopedFavorites, sessionTarget } from "./model";

/** Seed a legacy list, build the service (which migrates on construction), then
 * read the raw store back. The KV is shared (layerMemory), so the service
 * migrates the very list we seed. */
const buildWith = (seedLegacy: Option.Option<LegacyFavorites>) =>
  Effect.gen(function* () {
    const kv = yield* KeyValueStore.KeyValueStore;
    const legacy = KeyValueStore.toSchemaStore(kv, LegacyFavorites);
    const boards = KeyValueStore.toSchemaStore(kv, ScopedFavorites);
    if (Option.isSome(seedLegacy)) yield* legacy.set("list", seedLegacy.value);
    // Build Favorites now, against the already-seeded KV — migration runs here.
    yield* Favorites.pipe(Effect.provide(Favorites.layer));
    return {
      boards: yield* boards.get("boards"),
      legacy: yield* legacy.get("list"),
    };
  }).pipe(Effect.provide(KeyValueStore.layerMemory));

describe("migration", () => {
  it("folds the legacy flat list into the home board immediately, then discards it", async () => {
    const { boards, legacy } = await Effect.runPromise(
      buildWith(
        Option.some([
          { kind: "session", id: "a" },
          { kind: "repo", name: "app" },
        ]),
      ),
    );
    expect(Option.getOrNull(boards)).toEqual([{ scope: homeScope, items: [sessionTarget("a"), repoTarget("app")] }]);
    // Legacy key is gone — never read again.
    expect(Option.isNone(legacy)).toBe(true);
  });

  it("writes nothing and keeps empty when there is no legacy list", async () => {
    const { boards, legacy } = await Effect.runPromise(buildWith(Option.none()));
    expect(Option.isNone(boards)).toBe(true);
    expect(Option.isNone(legacy)).toBe(true);
  });
});

describe("toggle", () => {
  it("persists a scoped favorite and reflects it in the store", async () => {
    const boards = await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* Favorites;
        yield* store.toggle(homeScope, sessionTarget("x"));
        const kv = yield* KeyValueStore.KeyValueStore;
        return yield* KeyValueStore.toSchemaStore(kv, ScopedFavorites).get("boards");
      }).pipe(Effect.provide(Favorites.layer), Effect.provide(KeyValueStore.layerMemory)),
    );
    expect(Option.getOrNull(boards)).toEqual([{ scope: homeScope, items: [sessionTarget("x")] }]);
  });
});
