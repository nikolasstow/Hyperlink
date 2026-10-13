/**
 * Each screen's settled bar window, by navigation route key, and the detent the
 * Dubz window was last left at. BarWindow reports its settled state here when it
 * opens, closes, finishes a snap or the keyboard settles (never per frame), and
 * forgets its route on unmount; scroll views read the cover through
 * `useBarCover`. The detent memory moved here from `settings.ts`, persisted
 * through KeyValueStore with a Schema.
 *
 * Follows the app's store pattern (Context.Service over a SubscriptionRef + a
 * *Changes stream, layer in runtime.ts, React mirror via useSyncExternalStore),
 * as HomeLayoutStore does.
 *
 * @internal
 */
import { Context, Effect, Layer, Option, Schema, Stream, SubscriptionRef } from "effect";
import { KeyValueStore } from "effect/unstable/persistence";
import type { BarWindowState } from "./barWindowGeometry";

const DETENT_KEY = "dubzDetent";

/** The detent the Dubz window was last left at (replaces setDubzDetent). */
export const DubzDetent = Schema.Struct({
  frac: Schema.Number,
  kbFull: Schema.Number,
});
export type DubzDetent = typeof DubzDetent.Type;

const make = Effect.gen(function* () {
  const detentStore = KeyValueStore.toSchemaStore(yield* KeyValueStore.KeyValueStore, DubzDetent);
  const states = yield* SubscriptionRef.make<ReadonlyMap<string, BarWindowState>>(new Map());
  return {
    /** Each screen's settled window, by route key, as it changes. */
    changes: SubscriptionRef.changes(states),
    /** Keep a screen's window as it has just settled. */
    settle: (routeKey: string, state: BarWindowState) =>
      SubscriptionRef.update(states, (current) => {
        const next = new Map(current);
        next.set(routeKey, state);
        return next;
      }),
    /** Drop a screen's window (its bar unmounted). */
    forget: (routeKey: string) =>
      SubscriptionRef.update(states, (current) => {
        if (!current.has(routeKey)) return current;
        const next = new Map(current);
        next.delete(routeKey);
        return next;
      }),
    /** The persisted detent: read back at launch, kept whenever it changes. */
    detent: {
      get: detentStore.get(DETENT_KEY).pipe(
        Effect.map(Option.getOrUndefined),
        Effect.catch((error) => Effect.logError("[bar window] the kept detent could not be read", error).pipe(Effect.as(undefined))),
      ),
      set: (detent: DubzDetent) =>
        detentStore.set(DETENT_KEY, detent).pipe(Effect.catch((error) => Effect.logError("[bar window] saving the detent failed", error))),
    },
  };
});

export class BarWindowStore extends Context.Service<BarWindowStore, Effect.Success<typeof make>>()("@doubleagent/dubz/BarWindowStore") {
  static readonly layer = Layer.effect(BarWindowStore, make);
}

/** Each screen's settled window as it changes, for React. */
export const barWindowChanges = Stream.unwrap(
  Effect.gen(function* () {
    const store = yield* BarWindowStore;
    return store.changes;
  }),
);
