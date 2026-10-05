/**
 * Home's favorites (model.ts), kept on the device: read back at launch,
 * replaced whenever one is added or taken out.
 *
 * @internal
 */
import { Context, Effect, Layer, Option, Stream, SubscriptionRef } from "effect";
import { KeyValueStore } from "effect/unstable/persistence";
import { type Favorite, Favorites as FavoriteList, toggled } from "./model";

const STORE_KEY = "list";

const make = Effect.gen(function* () {
  const store = KeyValueStore.toSchemaStore(yield* KeyValueStore.KeyValueStore, FavoriteList);
  const stored = yield* store.get(STORE_KEY).pipe(
    Effect.map(Option.getOrElse((): FavoriteList => [])),
    Effect.catch((error) => Effect.logError("[favorites] the kept favorites could not be read; starting without them", error).pipe(Effect.as([]))),
  );
  const state = yield* SubscriptionRef.make<FavoriteList>(stored);
  return {
    /** The favorites, as they change (the current ones first). */
    changes: SubscriptionRef.changes(state),
    /** Adds a favorite, or takes it out when it is one. */
    toggle: (favorite: Favorite) =>
      SubscriptionRef.updateAndGet(state, (favorites) => toggled(favorites, favorite)).pipe(
        Effect.flatMap((favorites) => store.set(STORE_KEY, favorites)),
        Effect.catch((error) => Effect.logError("[favorites] saving failed", error)),
      ),
  };
});

export class Favorites extends Context.Service<Favorites, Effect.Success<typeof make>>()("@doubleagent/favorites/Favorites") {
  static readonly layer = Layer.effect(Favorites, make);
}

/** The favorites as they change, for React. */
export const favoritesChanges = Stream.unwrap(
  Effect.gen(function* () {
    const store = yield* Favorites;
    return store.changes;
  }),
);
