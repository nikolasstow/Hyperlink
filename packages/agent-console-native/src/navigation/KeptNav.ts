/**
 * The pages open when the app was last used (keptPages.ts), kept on the
 * device: read back at launch, replaced whenever the pages change.
 *
 * @internal
 */
import { Context, Effect, Layer, Option, Stream, SubscriptionRef } from "effect";
import { KeyValueStore } from "effect/unstable/persistence";
import { KeptPages } from "./keptPages";

const STORE_KEY = "pages";

const make = Effect.gen(function* () {
  const store = KeyValueStore.toSchemaStore(yield* KeyValueStore.KeyValueStore, KeptPages);
  const stored = yield* store.get(STORE_KEY).pipe(
    Effect.map(Option.getOrElse((): KeptPages => [])),
    Effect.catch((error) => Effect.logError("[kept nav] the kept pages could not be read; opening Home", error).pipe(Effect.as([]))),
  );
  const state = yield* SubscriptionRef.make<KeptPages>(stored);
  return {
    /** The kept pages, as they change (the current ones first). */
    changes: SubscriptionRef.changes(state),
    /** Keeps the pages open now. */
    keep: (pages: KeptPages) =>
      SubscriptionRef.set(state, pages).pipe(
        Effect.andThen(store.set(STORE_KEY, pages)),
        Effect.catch((error) => Effect.logError("[kept nav] saving failed", error)),
      ),
  };
});

export class KeptNav extends Context.Service<KeptNav, Effect.Success<typeof make>>()("@doubleagent/navigation/KeptNav") {
  static readonly layer = Layer.effect(KeptNav, make);
}

/** The kept pages as they change, for React. */
export const keptNavChanges = Stream.unwrap(
  Effect.gen(function* () {
    const store = yield* KeptNav;
    return store.changes;
  }),
);
