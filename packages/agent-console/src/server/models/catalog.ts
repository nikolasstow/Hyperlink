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

/** What is read of opencode's `GET /api/provider` (it carries more). */
const OpencodeProviders = Schema.Struct({
  data: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      name: Schema.String,
    }),
  ),
});

/** What is read of opencode's `GET /api/model` (it carries more, keys included). */
const OpencodeModel = Schema.Struct({
  id: Schema.String,
  providerID: Schema.String,
  name: Schema.String,
  enabled: Schema.Boolean,
});
const OpencodeModels = Schema.Struct({ data: Schema.Array(OpencodeModel) });
const OpencodeDefault = Schema.Struct({ data: Schema.optional(OpencodeModel) });

/** The catalog's lines: each provider with its enabled models (in opencode's
 * order), then the default (opencode has one, not one per provider). */
const linesOf = (
  providers: typeof OpencodeProviders.Type,
  models: typeof OpencodeModels.Type,
  fallback: typeof OpencodeDefault.Type,
): ReadonlyArray<Models.Line> => [
  ...providers.data.flatMap((provider): ReadonlyArray<Models.Line> => {
    const own = models.data.filter((model) => model.enabled && model.providerID === provider.id);
    return own.length === 0
      ? []
      : [{ _tag: "Provider", provider: { id: provider.id, name: provider.name, models: own.map((model) => ({ id: model.id, name: model.name })) } }];
  }),
  { _tag: "Defaults", defaults: fallback.data === undefined ? {} : { [fallback.data.providerID]: fallback.data.id } },
];

export const modelsRoute = HttpRouter.add("GET", Models.path, (request) =>
  Effect.gen(function* () {
    const directory = new URL(request.originalUrl, "http://localhost").searchParams.get("directory");
    const base = yield* opencodeUrl;
    const password = yield* opencodePassword;
    const http = yield* HttpClient.HttpClient;
    const urlParams = directory === null ? {} : { "location[directory]": directory };
    const read = <S extends Schema.Decoder<unknown>>(path: string, schema: S) =>
      http.get(`${base.replace(/\/+$/, "")}${path}`, { urlParams, headers: withOpencodeAuth(Headers.empty, password) }).pipe(
        Effect.flatMap(HttpClientResponse.filterStatusOk),
        Effect.flatMap(HttpClientResponse.schemaBodyJson(schema)),
      );
    const [providers, models, fallback] = yield* Effect.all(
      [read("/api/provider", OpencodeProviders), read("/api/model", OpencodeModels), read("/api/model/default", OpencodeDefault)],
      { concurrency: "unbounded" },
    );
    const body = Stream.fromIterable(linesOf(providers, models, fallback)).pipe(Stream.pipeThroughChannel(Ndjson.encodeSchemaString(Models.Line)()), Stream.encodeText);
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
