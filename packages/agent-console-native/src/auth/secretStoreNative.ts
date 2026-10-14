/**
 * `SecretStore` on the phone: the iOS Keychain through `expo-secure-store`.
 *
 * The package is loaded only when its native module is in the build: on a
 * build from before it, loading it would throw at launch. There the store is
 * not available, and pairing waits for a new build.
 *
 * @internal
 */
import { requireOptionalNativeModule } from "expo";
import { Effect, Layer, Option } from "effect";
import { SecretStore, SecretStoreError } from "./SecretStore";

const inBuild = requireOptionalNativeModule("ExpoSecureStore") !== null;

const failed = (message: string) => (cause: unknown) => new SecretStoreError({ message: `${message}: ${cause instanceof Error ? cause.message : String(cause)}` });

const unavailable = new SecretStoreError({ message: "this build has no Keychain module; install a newer build" });

/** The Keychain module, loaded once on first use. */
const secureStore = Effect.cached(Effect.tryPromise({ try: () => import("expo-secure-store"), catch: failed("loading the Keychain module") }));

export const layer = Layer.effect(
  SecretStore,
  Effect.map(secureStore, (load) => {
    const withStore = <A>(call: (store: typeof import("expo-secure-store")) => Promise<A>, what: string) =>
      inBuild ? load.pipe(Effect.flatMap((store) => Effect.tryPromise({ try: () => call(store), catch: failed(what) }))) : Effect.fail(unavailable);
    return {
      available: inBuild,
      get: (key: string) =>
        withStore((store) => store.getItemAsync(key, { keychainAccessible: store.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY }), `reading ${key}`).pipe(
          Effect.map(Option.fromNullishOr),
        ),
      set: (key: string, value: string) =>
        withStore((store) => store.setItemAsync(key, value, { keychainAccessible: store.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY }), `keeping ${key}`),
      remove: (key: string) =>
        withStore((store) => store.deleteItemAsync(key, { keychainAccessible: store.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY }), `removing ${key}`),
    };
  }),
);
