/**
 * `SecretStore` on the phone: the iOS Keychain, through expo-secure-store's
 * native module, called directly (`requireOptionalNativeModule`, as the app
 * reads ExpoNetwork and ExpoDevice). On a build from before the module, it is
 * missing: the store is not available and pairing waits for a new build.
 *
 * Not the package's JavaScript, loaded on demand: in development Metro served
 * it as its own bundle, and the accessibility constant it read came back
 * undefined, so the Keychain refused the value.
 *
 * @internal
 */
import { requireOptionalNativeModule } from "expo";
import { Effect, Layer, Option } from "effect";
import { SecretStore, SecretStoreError, type SecretStoreShape } from "./SecretStore";

/** What a Keychain call takes: when the value may be read. */
interface KeychainOptions {
  readonly keychainAccessible: number;
}

/** The parts of expo-secure-store's native module the app uses. */
interface ExpoSecureStore {
  readonly AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY?: number;
  readonly getValueWithKeyAsync: (key: string, options: KeychainOptions) => Promise<string | null>;
  readonly setValueWithKeyAsync: (value: string, key: string, options: KeychainOptions) => Promise<boolean>;
  readonly deleteValueWithKeyAsync: (key: string, options: KeychainOptions) => Promise<void>;
}

const native = requireOptionalNativeModule<ExpoSecureStore>("ExpoSecureStore");

/** Readable after the first unlock (background work still reaches it), and
 * never moved to another device with a backup. The module's own constant; its
 * value in the native enum (`SecureStoreAccessible.afterFirstUnlockThisDeviceOnly`
 * in expo-secure-store's SecureStoreAccessible.swift) when the build does not
 * expose it. */
const options: KeychainOptions = { keychainAccessible: native?.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY ?? 1 };

const failed = (message: string) => (cause: unknown) => new SecretStoreError({ message: `${message}: ${cause instanceof Error ? cause.message : String(cause)}` });

const unavailable = new SecretStoreError({ message: "this build has no Keychain module; install a newer build" });

const call = <A>(what: string, run: (keychain: ExpoSecureStore) => Promise<A>): Effect.Effect<A, SecretStoreError> =>
  native === null ? Effect.fail(unavailable) : Effect.tryPromise({ try: () => run(native), catch: failed(what) });

/** The Keychain as a `SecretStore`. */
export const keychain: SecretStoreShape = {
  available: native !== null,
  get: (key: string) => call(`reading ${key}`, (keychain) => keychain.getValueWithKeyAsync(key, options)).pipe(Effect.map(Option.fromNullishOr)),
  set: (key: string, value: string) => call(`keeping ${key}`, (keychain) => keychain.setValueWithKeyAsync(value, key, options)).pipe(Effect.asVoid),
  remove: (key: string) => call(`removing ${key}`, (keychain) => keychain.deleteValueWithKeyAsync(key, options)),
};

export const layer = Layer.succeed(SecretStore)(keychain);
