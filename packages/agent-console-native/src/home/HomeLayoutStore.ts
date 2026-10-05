/**
 * Home's last layout (homeLayout.ts), kept on the device for the launch
 * screen: read back at launch, replaced whenever Home's first screenful
 * changes.
 *
 * @internal
 */
import { Context, Effect, Layer, Option, Stream, SubscriptionRef } from "effect";
import { KeyValueStore } from "effect/unstable/persistence";
import { HomeLayout } from "./homeLayout";

const STORE_KEY = "layout";

const make = Effect.gen(function* () {
  const store = KeyValueStore.toSchemaStore(yield* KeyValueStore.KeyValueStore, HomeLayout);
  const stored = yield* store.get(STORE_KEY).pipe(
    Effect.map(Option.getOrElse((): HomeLayout => [])),
    Effect.catch((error) => Effect.logError("[home layout] the kept layout could not be read; starting without it", error).pipe(Effect.as([]))),
  );
  const state = yield* SubscriptionRef.make<HomeLayout>(stored);
  return {
    /** The kept layout, as it changes (the current one first). */
    changes: SubscriptionRef.changes(state),
    /** Keeps Home's layout as it is now. */
    keep: (layout: HomeLayout) =>
      SubscriptionRef.set(state, layout).pipe(
        Effect.andThen(store.set(STORE_KEY, layout)),
        Effect.catch((error) => Effect.logError("[home layout] saving failed", error)),
      ),
  };
});

export class HomeLayoutStore extends Context.Service<HomeLayoutStore, Effect.Success<typeof make>>()("@doubleagent/home/HomeLayoutStore") {
  static readonly layer = Layer.effect(HomeLayoutStore, make);
}

/** The kept layout as it changes, for React. */
export const homeLayoutChanges = Stream.unwrap(
  Effect.gen(function* () {
    const store = yield* HomeLayoutStore;
    return store.changes;
  }),
);
