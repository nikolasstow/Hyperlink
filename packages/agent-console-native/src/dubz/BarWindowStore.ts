/**
 * Each screen's settled bar window, by navigation route key, and the Dubz
 * window's remembered default height. BarWindow reports its settled state here
 * when it opens, closes, finishes a snap or the keyboard settles (never per
 * frame), and forgets its route on unmount; scroll views read the cover through
 * `useBarCover`. The remembered height (the user's default, which a drag sets)
 * is persisted through KeyValueStore with a Schema.
 *
 * Follows the app's store pattern (Context.Service over a SubscriptionRef + a
 * *Changes stream, layer in runtime.ts, React mirror via useSyncExternalStore),
 * as HomeLayoutStore does.
 *
 * @internal
 */
import { Context, Effect, Layer, Option, Schema, Stream, SubscriptionRef } from "effect";
import * as KeyValueStore from "effect/persistence/KeyValueStore";
import type { BarWindowState } from "./barWindowGeometry";

const PREFS_KEY = "dubzWindow";

/** What the Dubz window remembers across launches: the user's default height
 * (the height a drag release last set). The keyboard is NOT part of it — the
 * keyboard only clamps the height, it never changes the request. */
export const DubzWindowPrefs = Schema.Struct({
  height: Schema.Number,
});
export type DubzWindowPrefs = typeof DubzWindowPrefs.Type;

const make = Effect.gen(function* () {
  const prefsStore = KeyValueStore.toSchemaStore(yield* KeyValueStore.KeyValueStore, DubzWindowPrefs);
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
    /** The persisted default height: read back at launch, kept whenever a drag
     * sets a new one. */
    defaultHeight: {
      get: prefsStore.get(PREFS_KEY).pipe(
        Effect.map(Option.getOrUndefined),
        Effect.map((prefs) => prefs?.height),
        Effect.catch((error) => Effect.logError("[bar window] the kept height could not be read", error).pipe(Effect.as(undefined))),
      ),
      set: (height: number) =>
        prefsStore.set(PREFS_KEY, { height }).pipe(Effect.catch((error) => Effect.logError("[bar window] saving the height failed", error))),
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
