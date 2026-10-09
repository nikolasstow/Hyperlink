/**
 * Favorites (model.ts), kept on the device as one board per scope: read back at
 * launch, replaced whenever one is added, taken out, or reordered.
 *
 * On first run after the scoped rewrite the legacy flat list is **migrated into
 * the home board immediately and then discarded** — it is never read again.
 *
 * @internal
 */
import { Context, Effect, Layer, Option, Stream, SubscriptionRef } from "effect";
import { KeyValueStore } from "effect/unstable/persistence";
import { type FavoriteTarget, fromLegacy, LegacyFavorites, reordered, type Scope, ScopedFavorites, toggled } from "./model";

/** The scoped boards. */
const STORE_KEY = "boards";
/** The pre-rewrite flat list; read once to migrate, then removed. */
const LEGACY_KEY = "list";

const none: ScopedFavorites = [];

type BoardsStore = ReturnType<typeof KeyValueStore.toSchemaStore<typeof ScopedFavorites>>;

const make = Effect.gen(function* () {
  const kv = yield* KeyValueStore.KeyValueStore;
  const store = KeyValueStore.toSchemaStore(kv, ScopedFavorites);
  const initial = yield* load(kv, store);
  const state = yield* SubscriptionRef.make(initial);

  const persist = (next: ScopedFavorites) =>
    store.set(STORE_KEY, next).pipe(Effect.catch((error) => Effect.logError("[favorites] saving failed", error)));

  return {
    /** The favorites, as they change (the current ones first). */
    changes: SubscriptionRef.changes(state),
    /** Adds a target to a scope's board, or takes it out when it is one. */
    toggle: (scope: Scope, target: FavoriteTarget) =>
      SubscriptionRef.updateAndGet(state, (favorites) => toggled(favorites, scope, target)).pipe(Effect.flatMap(persist)),
    /** Replaces a scope's board order (for drag). */
    reorder: (scope: Scope, items: ReadonlyArray<FavoriteTarget>) =>
      SubscriptionRef.updateAndGet(state, (favorites) => reordered(favorites, scope, items)).pipe(Effect.flatMap(persist)),
  };
});

/** The scoped boards, else the migrated legacy list, else empty — any read
 * failure is logged, not hidden, and degrades to empty. */
const load = (kv: KeyValueStore.KeyValueStore, store: BoardsStore) =>
  store.get(STORE_KEY).pipe(
    Effect.flatMap(
      Option.match({
        onSome: Effect.succeed,
        onNone: () => migrateLegacy(kv, store),
      }),
    ),
    Effect.catch((error) => Effect.logError("[favorites] the kept favorites could not be read; starting without them", error).pipe(Effect.as(none))),
  );

/** Fold the legacy flat list into the home board, write the scoped boards, and
 * remove the legacy key — all at once, so it is migrated on first run and never
 * read again. */
const migrateLegacy = (kv: KeyValueStore.KeyValueStore, store: BoardsStore) => {
  const legacyStore = KeyValueStore.toSchemaStore(kv, LegacyFavorites);
  return legacyStore.get(LEGACY_KEY).pipe(
    Effect.flatMap(
      Option.match({
        onNone: () => Effect.succeed(none),
        onSome: (legacy) => {
          const boards = fromLegacy(legacy);
          return store.set(STORE_KEY, boards).pipe(
            Effect.andThen(legacyStore.remove(LEGACY_KEY)),
            Effect.as(boards),
          );
        },
      }),
    ),
    Effect.catch((error) => Effect.logError("[favorites] legacy favorites could not be migrated; starting without them", error).pipe(Effect.as(none))),
  );
};

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
