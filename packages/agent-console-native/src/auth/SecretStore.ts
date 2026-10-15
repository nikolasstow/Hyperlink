/**
 * Secrets kept on the device: the iOS Keychain on the phone
 * (secretStoreNative.ts), memory away from it (tests). Values stay readable
 * after the first unlock (background work still reaches them) and never move
 * to another device with a backup.
 *
 * `available` is false on a build without the Keychain module (built before
 * it was added): nothing can be kept there, so pairing waits for a new build.
 *
 * @internal
 */
import { Context, Data, Effect, Layer, Option, Ref } from "effect";

/** The Keychain could not be read or written. */
export class SecretStoreError extends Data.TaggedError("SecretStoreError")<{
  readonly message: string;
}> {}

export interface SecretStoreShape {
  readonly available: boolean;
  readonly get: (key: string) => Effect.Effect<Option.Option<string>, SecretStoreError>;
  readonly set: (key: string, value: string) => Effect.Effect<void, SecretStoreError>;
  readonly remove: (key: string) => Effect.Effect<void, SecretStoreError>;
}

export class SecretStore extends Context.Service<SecretStore, SecretStoreShape>()("@doubleagent/SecretStore") {
  /** Kept in memory: for tests. */
  static readonly layerMemory = Layer.effect(
    SecretStore,
    Effect.map(Ref.make<ReadonlyMap<string, string>>(new Map()), (kept) => ({
      available: true,
      get: (key: string) => Effect.map(Ref.get(kept), (all) => Option.fromNullishOr(all.get(key))),
      set: (key: string, value: string) => Ref.update(kept, (all) => new Map(all).set(key, value)),
      remove: (key: string) =>
        Ref.update(kept, (all) => {
          const next = new Map(all);
          next.delete(key);
          return next;
        }),
    })),
  );
}
