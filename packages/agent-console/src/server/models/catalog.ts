/**
 * `GET /models?directory=…`: the providers opencode is configured with in a
 * folder, and their models, streamed a line of NDJSON each (the
 * `agent-console-protocol` Models wire), the defaults last. The app keeps the
 * catalog on the device and shows each provider as it comes.
 *
 * Only ids and names go out: opencode's provider records carry API keys.
 *
 * @internal
 */
import { Effect, Schema, Stream } from "effect";
import { Ndjson } from "effect/encoding";
import { Headers, HttpClient, HttpClientResponse, HttpRouter, HttpServerResponse } from "effect/http";
import { Models } from "agent-console-protocol";
import { opencodePassword, opencodeUrl, withOpencodeAuth } from "../opencodeServer";

/** What is read of opencode's `GET /config/providers` (it carries more, keys included). */
const OpencodeProviders = Schema.Struct({
  providers: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      models: Schema.Record(
        Schema.String,
        Schema.Struct({
          id: Schema.String,
          name: Schema.String,
        }),
      ),
    }),
  ),
  default: Schema.Record(Schema.String, Schema.String),
});

/** The catalog's lines: each provider with its models, then the defaults. */
const linesOf = (catalog: typeof OpencodeProviders.Type): ReadonlyArray<Models.Line> => [
  ...catalog.providers.map(
    (provider): Models.Line => ({
      _tag: "Provider",
      provider: {
        id: provider.id,
        name: provider.name,
        models: Object.values(provider.models).map((model) => ({ id: model.id, name: model.name })),
      },
    }),
  ),
  { _tag: "Defaults", defaults: catalog.default },
];

export const modelsRoute = HttpRouter.add("GET", Models.path, (request) =>
  Effect.gen(function* () {
    const directory = new URL(request.originalUrl, "http://localhost").searchParams.get("directory");
    const base = yield* opencodeUrl;
    const password = yield* opencodePassword;
    const http = yield* HttpClient.HttpClient;
    const query = directory === null ? "" : `?directory=${encodeURIComponent(directory)}`;
    const catalog = yield* http.get(`${base.replace(/\/+$/, "")}/config/providers${query}`, { headers: withOpencodeAuth(Headers.empty, password) }).pipe(
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      Effect.flatMap(HttpClientResponse.schemaBodyJson(OpencodeProviders)),
    );
    const body = Stream.fromIterable(linesOf(catalog)).pipe(Stream.pipeThroughChannel(Ndjson.encodeSchemaString(Models.Line)()), Stream.encodeText);
    return HttpServerResponse.stream(body, {
      contentType: "application/x-ndjson",
      headers: {
        "cache-control": "no-store",
      },
    });
  }).pipe(
    Effect.catch((error) =>
      Effect.logWarning("models: the catalog could not be read from opencode", error).pipe(
        Effect.as(HttpServerResponse.jsonUnsafe({ error: "opencode unreachable" }, { status: 502 })),
      ),
    ),
  ),
);
