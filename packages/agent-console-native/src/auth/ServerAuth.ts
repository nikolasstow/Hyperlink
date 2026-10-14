/**
 * The servers this phone is paired with (docs/handoffs/app-auth.md). Pairing
 * redeems a server's single-use code for this device's own token: the token
 * is kept in the Keychain (`SecretStore`), the list of paired servers on the
 * device (`KeyValueStore`), and both are read back at launch. Every request to
 * a paired server then carries its token (serverTokens.ts).
 *
 * @internal
 */
import { Context, Data, Duration, Effect, Layer, Option, Schema, Stream, SubscriptionRef } from "effect";
import { Base64Url } from "effect/encoding";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";
import * as KeyValueStore from "effect/persistence/KeyValueStore";
import { DeviceSignals } from "../effect/DeviceSignals";
import { originOf } from "./serverTokens";
import { SecretStore } from "./SecretStore";

const STORE_KEY = "paired";
/** How long a server address may take to answer before the next is tried. */
const HEALTH_TIMEOUT = Duration.seconds(3);

/** Each paired server, by origin: this device's id there. */
const PairedServers = Schema.Record(
  Schema.String,
  Schema.Struct({
    deviceId: Schema.String,
  }),
);
type PairedServers = typeof PairedServers.Type;

/** What redeeming a code gives this device. */
const Paired = Schema.Struct({
  id: Schema.String,
  token: Schema.String,
});

/** A device paired with a server, as the server lists it. */
export const PairedDevice = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  pairedAt: Schema.Number,
  lastSeenAt: Schema.Number,
});
export type PairedDevice = typeof PairedDevice.Type;

/** The devices paired with one server, and which of them is this phone. */
export interface ServerDevices {
  readonly devices: ReadonlyArray<PairedDevice>;
  readonly thisDevice: string;
}

/** A pairing that did not happen, and why. */
export class PairingError extends Data.TaggedError("PairingError")<{
  readonly reason: "Unreachable" | "Refused" | "NoKeychain" | "Failed";
  readonly message: string;
}> {}

/** The Keychain key of a server's token (letters, digits, `-` and `_` only). */
const tokenKey = (origin: string): string => `server-token.${Base64Url.encode(origin)}`;

const make = Effect.gen(function* () {
  const store = KeyValueStore.toSchemaStore(yield* KeyValueStore.KeyValueStore, PairedServers);
  const secrets = yield* SecretStore;
  const http = yield* HttpClient.HttpClient;
  /** The paired servers' tokens, by origin. */
  const tokens = yield* SubscriptionRef.make<ReadonlyMap<string, string>>(new Map());

  const paired = store.get(STORE_KEY).pipe(Effect.map(Option.getOrElse((): PairedServers => ({}))));
  /** Each paired server's devices, as last fetched. */
  const devices = yield* SubscriptionRef.make<ReadonlyMap<string, ServerDevices>>(new Map());

  /** Fetches the devices paired with `origin` and keeps them. */
  const refreshDevices = (origin: string) =>
    Effect.gen(function* () {
      const deviceId = (yield* paired)[origin]?.deviceId;
      if (deviceId === undefined) return;
      const listed = yield* http.get(`${origin}/auth/devices`).pipe(
        Effect.flatMap(HttpClientResponse.filterStatusOk),
        Effect.flatMap(HttpClientResponse.schemaBodyJson(Schema.Array(PairedDevice))),
      );
      yield* SubscriptionRef.update(devices, (all) => new Map(all).set(origin, { devices: listed, thisDevice: deviceId }));
    }).pipe(Effect.catch((error) => Effect.logWarning(`[auth] the devices of ${origin} could not be listed`, error)));

  /** Every paired server's devices, fetched again. */
  const refreshAll = paired.pipe(
    Effect.flatMap((servers) => Effect.forEach(Object.keys(servers), refreshDevices, { discard: true })),
    Effect.catch((error) => Effect.logWarning("[auth] the paired servers could not be read", error)),
  );

  // Back in the foreground: the lists again, so Settings shows them current
  // when opened (nothing loads on the tap).
  yield* (yield* DeviceSignals).signals.pipe(
    Stream.filter((signal) => signal === "foreground"),
    Stream.runForEach(() => refreshAll),
    Effect.forkScoped,
  );

  /** The first of `urls` that answers as a server. */
  const firstReachable = (urls: ReadonlyArray<string>) =>
    Effect.findFirst(urls, (url) =>
      http.get(`${url}/health`).pipe(
        Effect.flatMap(HttpClientResponse.filterStatusOk),
        Effect.timeout(HEALTH_TIMEOUT),
        Effect.as(true),
        Effect.catch(() => Effect.succeed(false)),
      ),
    );

  const forgetOrigin = (origin: string) =>
    Effect.gen(function* () {
      yield* secrets.remove(tokenKey(origin));
      const known = yield* paired;
      yield* store.set(STORE_KEY, Object.fromEntries(Object.entries(known).filter(([kept]) => kept !== origin)));
      yield* SubscriptionRef.update(tokens, (all) => {
        const next = new Map(all);
        next.delete(origin);
        return next;
      });
    });

  return {
    /** Every paired server's token, by origin, as it changes. */
    changes: SubscriptionRef.changes(tokens),
    /** Each paired server's devices, as fetched (at launch and on return). */
    devicesChanges: SubscriptionRef.changes(devices),
    /** Whether this build can keep a token at all. */
    canPair: secrets.available,
    /** Reads back the paired servers and their tokens (at launch). */
    readBack: paired.pipe(
      Effect.flatMap((servers) =>
        Effect.forEach(Object.keys(servers), (origin) =>
          secrets.get(tokenKey(origin)).pipe(Effect.map(Option.map((token): readonly [string, string] => [origin, token]))),
        ),
      ),
      Effect.flatMap((found) => SubscriptionRef.set(tokens, new Map(found.flatMap(Option.toArray)))),
      Effect.catch((error) => Effect.logError("[auth] the paired servers could not be read back", error)),
      // Their device lists after, without holding the launch.
      Effect.tap(() => Effect.forkDetach(refreshAll)),
    ),
    /** Removes a device from a server; this phone's own removal forgets the server here too. */
    revoke: (origin: string, id: string) =>
      Effect.gen(function* () {
        yield* HttpClientRequest.post(`${origin}/auth/revoke`).pipe(
          HttpClientRequest.bodyJsonUnsafe({ id }),
          http.execute,
          Effect.flatMap(HttpClientResponse.filterStatusOk),
        );
        if ((yield* paired)[origin]?.deviceId === id) {
          yield* SubscriptionRef.update(devices, (all) => {
            const next = new Map(all);
            next.delete(origin);
            return next;
          });
          return yield* forgetOrigin(origin);
        }
        yield* refreshDevices(origin);
      }),
    /**
     * Pairs with the server at the first of `urls` that answers, redeeming
     * `code` as this device (`name`). The server's origin, now paired.
     */
    pair: (urls: ReadonlyArray<string>, code: string, name: string) =>
      Effect.gen(function* () {
        if (!secrets.available) return yield* new PairingError({ reason: "NoKeychain", message: "Install the newest build to pair this phone." });
        const reachable = yield* firstReachable(urls);
        const url = Option.getOrUndefined(reachable);
        const origin = url === undefined ? undefined : originOf(url);
        if (url === undefined || origin === undefined) return yield* new PairingError({ reason: "Unreachable", message: `No answer from ${urls.join(", ")}.` });
        const response = yield* HttpClientRequest.post(`${origin}/auth/redeem`).pipe(
          HttpClientRequest.bodyJsonUnsafe({ code, name }),
          http.execute,
          Effect.mapError((error) => new PairingError({ reason: "Unreachable", message: error.message })),
        );
        if (response.status === 403) return yield* new PairingError({ reason: "Refused", message: "That code is used or expired. Run pnpm pair again." });
        const device = yield* HttpClientResponse.schemaBodyJson(Paired)(response).pipe(
          Effect.mapError((error) => new PairingError({ reason: "Failed", message: error.message })),
        );
        // The code is used now. If keeping the token fails, the device the
        // server just made is removed (with its own token), so pairing again
        // starts clean instead of leaving a device nobody can use.
        yield* Effect.gen(function* () {
          yield* secrets.set(tokenKey(origin), device.token);
          const known = yield* paired;
          yield* store.set(STORE_KEY, { ...known, [origin]: { deviceId: device.id } });
        }).pipe(
          Effect.tapError(() =>
            HttpClientRequest.post(`${origin}/auth/revoke`).pipe(
              HttpClientRequest.bearerToken(device.token),
              HttpClientRequest.bodyJsonUnsafe({ id: device.id }),
              http.execute,
              Effect.catch((error) => Effect.logWarning(`[auth] the half-paired device on ${origin} could not be removed`, error)),
            ),
          ),
          Effect.mapError((error) => new PairingError({ reason: "Failed", message: `${error.message}. Nothing was kept; run pnpm pair again.` })),
        );
        yield* SubscriptionRef.update(tokens, (all) => new Map(all).set(origin, device.token));
        yield* Effect.forkDetach(refreshDevices(origin));
        return origin;
      }),
    /** Forgets a server: its token and its place in the list. */
    forget: (origin: string) => forgetOrigin(origin),
  };
});

export class ServerAuth extends Context.Service<ServerAuth, Effect.Success<typeof make>>()("@doubleagent/ServerAuth") {
  static readonly layer = Layer.effect(ServerAuth, make);
}
