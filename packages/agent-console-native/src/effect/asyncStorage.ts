/**
 * Effect's `KeyValueStore` over React Native's AsyncStorage (persisted on the
 * device, asynchronous; Effect's own `layerStorage` takes a synchronous
 * `Storage`), scoped to a key prefix: `clear` and `size` see only the
 * store's own keys, never the rest of the app's storage. Every failure is a
 * `KeyValueStoreError` naming the key and the operation.
 *
 * @internal
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Effect, Layer } from "effect";
import { KeyValueStore } from "effect/unstable/persistence";

const attempt = <A>(method: string, key: string | undefined, run: () => Promise<A>) =>
  Effect.tryPromise({
    try: run,
    catch: (cause) =>
      new KeyValueStore.KeyValueStoreError({
        method,
        key,
        message: key === undefined ? `AsyncStorage ${method} failed` : `AsyncStorage ${method} failed for ${key}`,
        cause,
      }),
  });

/** A store of the keys under `prefix` (stored as `prefix` + key). */
export const layer = (prefix: string) => {
  const own = attempt("keys", undefined, () => AsyncStorage.getAllKeys()).pipe(
    Effect.map((keys) => keys.filter((key) => key.startsWith(prefix))),
  );
  return Layer.succeed(KeyValueStore.KeyValueStore)(
    KeyValueStore.makeStringOnly({
      get: (key) => attempt("get", key, () => AsyncStorage.getItem(prefix + key)).pipe(Effect.map((value) => value ?? undefined)),
      set: (key, value) => attempt("set", key, () => AsyncStorage.setItem(prefix + key, value)),
      remove: (key) => attempt("remove", key, () => AsyncStorage.removeItem(prefix + key)),
      clear: own.pipe(Effect.flatMap((keys) => attempt("clear", undefined, () => AsyncStorage.multiRemove(keys)))),
      size: own.pipe(Effect.map((keys) => keys.length)),
    }),
  );
};
