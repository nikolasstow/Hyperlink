import { Effect, Layer, Option, Stream } from "effect";
import { FetchHttpClient } from "effect/http";
import * as KeyValueStore from "effect/persistence/KeyValueStore";
import { describe, expect, it } from "vitest";
import { DeviceSignals } from "../effect/DeviceSignals";
import { SecretStore, SecretStoreError } from "./SecretStore";
import { ServerAuth } from "./ServerAuth";

/** A stand-in server: answers /health at `up` origins, redeems `code` once. */
const fakeServer = (options: { readonly up: ReadonlyArray<string>; readonly code: string; readonly revoked?: Array<string> }) => {
  let redeemed = false;
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  return (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (!options.up.includes(url.origin)) return Promise.reject(new TypeError("fetch failed"));
    if (url.pathname === "/health") return Promise.resolve(json({ status: "ok" }));
    if (url.pathname === "/auth/redeem") {
      const raw = init?.body;
      const body: unknown = JSON.parse(typeof raw === "string" ? raw : raw instanceof Uint8Array ? new TextDecoder().decode(raw) : "{}");
      const code = typeof body === "object" && body !== null && "code" in body ? body.code : undefined;
      if (redeemed || code !== options.code) return Promise.resolve(json({ _tag: "PairingRefused" }, 403));
      redeemed = true;
      return Promise.resolve(json({ id: "device-1", token: "token-1" }));
    }
    if (url.pathname === "/auth/revoke") {
      options.revoked?.push(new Headers(init?.headers).get("authorization") ?? "none");
      return Promise.resolve(json([]));
    }
    if (url.pathname === "/auth/devices") return Promise.resolve(json([{ id: "device-1", name: "Phone", pairedAt: 1, lastSeenAt: 2 }]));
    return Promise.resolve(json({}, 404));
  };
};

type FakeFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/** ServerAuth over the stores in context (shared between runs). */
const authOver = (fetch: FakeFetch) =>
  Layer.fresh(ServerAuth.layer).pipe(
    Layer.provide([Layer.succeed(DeviceSignals)({ signals: Stream.never }), FetchHttpClient.layer.pipe(Layer.provide(Layer.succeed(FetchHttpClient.Fetch)(fetch)))]),
  );

const stores = (secrets: Layer.Layer<SecretStore> = SecretStore.layerMemory) => Layer.mergeAll(KeyValueStore.layerMemory, secrets);

const tokensNow = Effect.gen(function* () {
  return yield* (yield* ServerAuth).changes.pipe(Stream.take(1), Stream.runCollect);
});

describe("ServerAuth", () => {
  it("pairs at the first address that answers", async () => {
    const fetch = fakeServer({ up: ["http://192.168.1.40:5299"], code: "ABCD2345" });
    const origin = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* (yield* ServerAuth).pair(["http://100.67.32.32:5299", "http://192.168.1.40:5299"], "ABCD2345", "Phone");
      }).pipe(Effect.provide(authOver(fetch)), Effect.provide(stores())),
    );
    expect(origin).toBe("http://192.168.1.40:5299");
  });

  it("keeps the token: read back in a new run, until the server is forgotten", async () => {
    const fetch = fakeServer({ up: ["http://h:1"], code: "C" });
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const paired = yield* Effect.gen(function* () {
          yield* (yield* ServerAuth).pair(["http://h:1"], "C", "Phone");
          return yield* tokensNow;
        }).pipe(Effect.provide(authOver(fetch)));
        const restarted = yield* Effect.gen(function* () {
          const auth = yield* ServerAuth;
          yield* auth.readBack;
          const before = yield* tokensNow;
          yield* auth.forget("http://h:1");
          return { before, after: yield* tokensNow };
        }).pipe(Effect.provide(authOver(fetch)));
        const third = yield* Effect.gen(function* () {
          yield* (yield* ServerAuth).readBack;
          return yield* tokensNow;
        }).pipe(Effect.provide(authOver(fetch)));
        return { paired, ...restarted, third };
      }).pipe(Effect.provide(stores())),
    );
    expect([...(result.paired[0] ?? new Map())]).toEqual([["http://h:1", "token-1"]]);
    expect([...(result.before[0] ?? new Map())]).toEqual([["http://h:1", "token-1"]]);
    expect(result.after[0]?.size).toBe(0);
    expect(result.third[0]?.size).toBe(0);
  });

  it("says why a pairing did not happen", async () => {
    const fetch = fakeServer({ up: ["http://h:1"], code: "RIGHT" });
    const failures = await Effect.runPromise(
      Effect.gen(function* () {
        const auth = yield* ServerAuth;
        const wrong = yield* Effect.flip(auth.pair(["http://h:1"], "WRONG", "Phone"));
        const nobody = yield* Effect.flip(auth.pair(["http://down:9"], "RIGHT", "Phone"));
        return [wrong.reason, nobody.reason];
      }).pipe(Effect.provide(authOver(fetch)), Effect.provide(stores())),
    );
    expect(failures).toEqual(["Refused", "Unreachable"]);
    const noKeychain = Layer.succeed(SecretStore)({
      available: false,
      get: () => Effect.succeed(Option.none()),
      set: () => Effect.void,
      remove: () => Effect.void,
    });
    const reason = await Effect.runPromise(
      Effect.gen(function* () {
        return (yield* Effect.flip((yield* ServerAuth).pair(["http://h:1"], "RIGHT", "Phone"))).reason;
      }).pipe(Effect.provide(authOver(fetch)), Effect.provide(stores(noKeychain))),
    );
    expect(reason).toBe("NoKeychain");
  });

  it("removes the device the server made when the token cannot be kept", async () => {
    const revoked: Array<string> = [];
    const fetch = fakeServer({ up: ["http://h:1"], code: "C", revoked });
    const failingKeychain = Layer.succeed(SecretStore)({
      available: true,
      get: () => Effect.succeed(Option.none()),
      set: () => Effect.fail(new SecretStoreError({ message: "keychain refused" })),
      remove: () => Effect.void,
    });
    const reason = await Effect.runPromise(
      Effect.gen(function* () {
        return (yield* Effect.flip((yield* ServerAuth).pair(["http://h:1"], "C", "Phone"))).reason;
      }).pipe(Effect.provide(authOver(fetch)), Effect.provide(stores(failingKeychain))),
    );
    expect(reason).toBe("Failed");
    expect(revoked).toEqual(["Bearer token-1"]);
  });
});
