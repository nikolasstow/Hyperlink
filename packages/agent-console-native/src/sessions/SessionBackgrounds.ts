/**
 * Each session's own chat background, light and dark, when it has one; a
 * session without one inherits the app's (Appearance → Background). Kept on
 * the device (KeyValueStore), read back at launch.
 *
 * @internal
 */
import { Context, Effect, HashMap, Layer, Option, Schema, Stream, SubscriptionRef } from "effect";
import { KeyValueStore } from "effect/unstable/persistence";

export const SessionBackground = Schema.Struct({
  light: Schema.optional(Schema.String),
  dark: Schema.optional(Schema.String),
});
export type SessionBackground = typeof SessionBackground.Type;

const Stored = Schema.Record(Schema.String, SessionBackground);
const STORE_KEY = "backgrounds";

export type BackgroundMode = "light" | "dark";

const make = Effect.gen(function* () {
  const store = KeyValueStore.toSchemaStore(yield* KeyValueStore.KeyValueStore, Stored);
  const stored = yield* store.get(STORE_KEY).pipe(
    Effect.map(Option.getOrElse((): typeof Stored.Type => ({}))),
    Effect.catch((error) => Effect.logError("[session backgrounds] the stored backgrounds could not be read; starting without them", error).pipe(Effect.as({}))),
  );
  const state = yield* SubscriptionRef.make(HashMap.fromIterable(Object.entries(stored)));

  return {
    /** Every session's background, as they change (the current ones first). */
    changes: SubscriptionRef.changes(state),
    /** Sets one mode's colour for a session, or (undefined) back to the app's. */
    set: (sessionID: string, mode: BackgroundMode, color: string | undefined) =>
      SubscriptionRef.updateAndGet(state, (all) => {
        const current = Option.getOrElse(HashMap.get(all, sessionID), (): SessionBackground => ({}));
        const next: SessionBackground = { ...current, [mode]: color };
        return next.light === undefined && next.dark === undefined ? HashMap.remove(all, sessionID) : HashMap.set(all, sessionID, next);
      }).pipe(
        Effect.flatMap((all) => store.set(STORE_KEY, Object.fromEntries(all))),
        Effect.catch((error) => Effect.logError("[session backgrounds] saving failed", error)),
      ),
  };
});

export class SessionBackgrounds extends Context.Service<SessionBackgrounds, Effect.Success<typeof make>>()("@doubleagent/sessions/SessionBackgrounds") {
  static readonly layer = Layer.effect(SessionBackgrounds, make);
}

/** Every session's background as it changes, for React. */
export const sessionBackgroundChanges = Stream.unwrap(
  Effect.gen(function* () {
    const backgrounds = yield* SessionBackgrounds;
    return backgrounds.changes;
  }),
);
