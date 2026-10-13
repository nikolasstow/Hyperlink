/**
 * Where each file was left: how far down its code rested (points from the
 * top), kept on the device, so a file reopens where it was and its tab's
 * preview shows the same place (filePreview.ts). Read back at launch.
 *
 * @internal
 */
import { Context, Effect, Layer, Option, Schema, SubscriptionRef } from "effect";
import { KeyValueStore } from "effect/unstable/persistence";

const STORE_KEY = "scrolls";

/** Each file's resting offset, by path. */
const fileScrolls = Schema.Record(Schema.String, Schema.Number);

const make = Effect.gen(function* () {
  const store = KeyValueStore.toSchemaStore(yield* KeyValueStore.KeyValueStore, fileScrolls);
  const stored = yield* store.get(STORE_KEY).pipe(
    Effect.map(Option.getOrElse((): typeof fileScrolls.Type => ({}))),
    Effect.catch((error) => Effect.logError("[files] the kept scroll positions could not be read; starting without them", error).pipe(Effect.as({}))),
  );
  const state = yield* SubscriptionRef.make<typeof fileScrolls.Type>(stored);
  return {
    /** Every file's resting offset as it changes (the current ones first). */
    changes: SubscriptionRef.changes(state),
    /** Keeps where a file came to rest. */
    keep: (path: string, offset: number) =>
      SubscriptionRef.updateAndGet(state, (scrolls) => ({
        ...scrolls,
        [path]: offset,
      })).pipe(
        Effect.flatMap((scrolls) => store.set(STORE_KEY, scrolls)),
        Effect.catch((error) => Effect.logError("[files] keeping a scroll position failed", error)),
      ),
  };
});

export class FileScrolls extends Context.Service<FileScrolls, Effect.Success<typeof make>>()("@doubleagent/files/FileScrolls") {
  static readonly layer = Layer.effect(FileScrolls, make);
}
