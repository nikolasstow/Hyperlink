/**
 * opencode v2 clients, one per server: each an `HttpApiClient` derived from
 * the vendored API (`./api`), so requests are encoded and responses decoded
 * with the server's own schemas. Built once per server and kept.
 *
 * Servers are named by their base URL (`ServerAddress`, serverAddress.ts);
 * the app talks to one today and is built to talk to several.
 *
 * @internal
 */
import { Context, Effect, HashMap, Layer, Option, SynchronizedRef } from "effect";
import { HttpClient } from "effect/unstable/http";
import { HttpApiClient } from "effect/unstable/httpapi";
import { OpencodeApi } from "./api";
import type { ServerAddress } from "./serverAddress";

const makeClient = (server: ServerAddress) => HttpApiClient.make(OpencodeApi, { baseUrl: server });

/** A server's typed v2 client. */
export type OpencodeClient = Effect.Success<ReturnType<typeof makeClient>>;

type Clients = HashMap.HashMap<ServerAddress, OpencodeClient>;

const make = Effect.gen(function* () {
  const httpClient = yield* HttpClient.HttpClient;
  const clients = yield* SynchronizedRef.make<Clients>(HashMap.empty());
  return {
    /** The server's client, made on first use. */
    client: (server: ServerAddress): Effect.Effect<OpencodeClient> =>
      SynchronizedRef.modifyEffect(clients, (known): Effect.Effect<readonly [OpencodeClient, Clients]> =>
        Option.match(HashMap.get(known, server), {
          onSome: (client) => Effect.succeed([client, known]),
          onNone: () =>
            makeClient(server).pipe(
              Effect.provideService(HttpClient.HttpClient, httpClient),
              Effect.map((client) => [client, HashMap.set(known, server, client)]),
            ),
        }),
      ),
  };
});

export class Opencode extends Context.Service<Opencode, Effect.Success<typeof make>>()("@doubleagent/Opencode") {
  static readonly layer = Layer.effect(Opencode, make);
}
