/**
 * The printer relay's access token (saturn-uploader's `relayToken`), kept in
 * the Keychain by relay origin. With no token the app sends none, as before.
 *
 * With a token:
 * - every request to the relay carries `Authorization: Bearer <token>`
 *   (auth/serverTokens.ts keeps it for the relay's origin, so `authedFetch`,
 *   `authHeaders`, `authedSource`, and the Effect HTTP client send it);
 * - the native Live Activity token sender sends it (`setPrinterRelayToken`);
 * - the camera's web view adds `?token=` to its address (`cameraPageUrl`).
 *
 * Settings → Connection changes it.
 *
 * @internal
 */
import { Effect, Option } from "effect";
import * as React from "react";
import { setPrinterRelayToken } from "../../modules/live-activity";
import { SecretStore } from "../auth/SecretStore";
import { keychain } from "../auth/secretStoreNative";
import { originOf, setRelayToken } from "../auth/serverTokens";

/** Runs a Keychain step. */
const withKeychain = <A, E>(effect: Effect.Effect<A, E, SecretStore>): Promise<A> => Effect.runPromise(effect.pipe(Effect.provideService(SecretStore, keychain)));

let known: ReadonlyMap<string, string> = new Map();
const listeners = new Set<() => void>();
const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** The Keychain key for the relay at `origin`. Keychain keys take letters, digits, `.`, `-`, and `_` only. */
export const keyOf = (origin: string): string => `agent-console-native.printer.relay-token.${origin.replace(/[^A-Za-z0-9._-]/g, "_")}`;

/** The relay's origin (`http://host:5197`) from its base address. */
const relayOrigin = (relayBase: string): string => originOf(relayBase) ?? relayBase;

/** Uses `token` for the relay at `origin` from now on, everywhere the app reaches it. */
const apply = (origin: string, token: string | undefined): void => {
  setRelayToken(origin, token);
  setPrinterRelayToken(token ?? "");
  const next = new Map(known);
  if (token === undefined) next.delete(origin);
  else next.set(origin, token);
  known = next;
  listeners.forEach((listener) => listener());
};

/** Reads the relay's token from the Keychain and uses it (at launch, once the relay's address is known). */
export const loadRelayToken = (relayBase: string): Promise<void> => {
  const origin = relayOrigin(relayBase);
  return withKeychain(
    SecretStore.pipe(
      Effect.flatMap((store) => (store.available ? store.get(keyOf(origin)) : Effect.succeed(Option.none<string>()))),
      Effect.map((token) => apply(origin, Option.getOrUndefined(token))),
    ),
  );
};

/** Keeps `token` for the relay (an empty text removes it) and uses it at once. */
export const saveRelayToken = (relayBase: string, token: string): Promise<void> => {
  const origin = relayOrigin(relayBase);
  const trimmed = token.trim();
  return withKeychain(
    SecretStore.pipe(
      Effect.flatMap((store) => (trimmed === "" ? store.remove(keyOf(origin)) : store.set(keyOf(origin), trimmed))),
      Effect.map(() => apply(origin, trimmed === "" ? undefined : trimmed)),
    ),
  );
};

/** The relay's token, as it changes; `undefined` when it has none. */
export const useRelayToken = (relayBase: string): string | undefined => React.useSyncExternalStore(subscribe, () => known.get(relayOrigin(relayBase)));

/**
 * The relay's camera page, for the full-screen web view. A web view keeps its
 * own cookies and cannot send a header, so with a token the address carries
 * it: the relay signs the view in and drops the token from the address.
 */
export const cameraPageUrl = (base: string, token: string | undefined): string =>
  `${base}/?view=camera&bare=1${token === undefined ? "" : `&token=${encodeURIComponent(token)}`}`;
