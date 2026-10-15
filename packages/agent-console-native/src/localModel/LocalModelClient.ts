/**
 * The API server's local model (agent-console-protocol `LocalModel`): its
 * settings and state, as the server last sent them, and the changes the
 * Local model page makes. Fetched at app open and on return to the
 * foreground (useLocalModel.ts `LocalModelSync`), so the page has it before
 * it opens; fetched again while the page is open.
 *
 * @internal
 */
import { LocalModel } from "agent-console-protocol";
import { Context, Effect, Layer, Option, SubscriptionRef } from "effect";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";

const make = Effect.gen(function* () {
  const http = yield* HttpClient.HttpClient;
  const overview = yield* SubscriptionRef.make<Option.Option<LocalModel.Overview>>(Option.none());

  /** Sends `request`, and keeps the overview it answers. */
  const send = (request: HttpClientRequest.HttpClientRequest) =>
    http.execute(request).pipe(
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      Effect.flatMap(HttpClientResponse.schemaBodyJson(LocalModel.Overview)),
      Effect.tap((next) => SubscriptionRef.set(overview, Option.some(next))),
    );

  return {
    /** The overview, as it changes (none until the first answer). */
    changes: SubscriptionRef.changes(overview),
    /** Fetches it from `server`. */
    refresh: (server: string) => send(HttpClientRequest.get(`${server}/local-model`)),
    /** Turns it on or off, or changes the model. */
    setSettings: (server: string, settings: LocalModel.Settings) =>
      send(HttpClientRequest.put(`${server}/local-model/settings`).pipe(HttpClientRequest.bodyJsonUnsafe(settings))),
    /** Installs llama.cpp on the server. */
    install: (server: string) => send(HttpClientRequest.post(`${server}/local-model/install`)),
    /** Stops it and starts it again. */
    restart: (server: string) => send(HttpClientRequest.post(`${server}/local-model/restart`)),
  };
});

export class LocalModelClient extends Context.Service<LocalModelClient, Effect.Success<typeof make>>()("@doubleagent/localModel/LocalModelClient") {
  static readonly layer = Layer.effect(LocalModelClient, make);
}
