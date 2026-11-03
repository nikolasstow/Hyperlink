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
import { Data, Effect, Schedule, Schema, Stream } from "effect";
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

/** opencode answered for a folder it had not finished loading: no provider
 * had a model yet. Not a catalog — a client that kept it would show an empty
 * picker until something refreshed it. */
class CatalogNotReady extends Data.TaggedError("CatalogNotReady") {}

/** How often, and how many times, a not-ready folder is asked again before
 * the route gives up for this request. A cold folder is ready well inside a
 * second; a folder with no providers at all costs the caller this long once. */
const notReadyRetry = Schedule.spaced("300 millis").pipe(Schedule.upTo({ times: 5 }));

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
    const readAll = Effect.all(
      [read("/api/provider", OpencodeProviders), read("/api/model", OpencodeModels), read("/api/model/default", OpencodeDefault)],
      { concurrency: "unbounded" },
    ).pipe(
      Effect.map(([providers, models, fallback]) => linesOf(providers, models, fallback)),
      Effect.filterOrFail(
        (lines) => lines.some((line) => line._tag === "Provider"),
        () => new CatalogNotReady(),
      ),
    );
    const lines = yield* readAll.pipe(
      Effect.retry({
        while: (error) => error._tag === "CatalogNotReady",
        schedule: notReadyRetry,
      }),
    );
    const body = Stream.fromIterable(lines).pipe(
      Stream.pipeThroughChannel(Ndjson.encodeSchemaString(Models.Line)()),
      Stream.encodeText,
    );
    return HttpServerResponse.stream(body, {
      contentType: "application/x-ndjson",
      headers: {
        "cache-control": "no-store",
      },
    });
  }).pipe(
    // Not ready is 503, never an empty 200: a client must not keep it.
    Effect.catchTag("CatalogNotReady", () =>
      Effect.logWarning("models: opencode has no providers for this folder yet").pipe(
        Effect.as(HttpServerResponse.jsonUnsafe({ error: "opencode has no providers for this folder yet" }, { status: 503, headers: { "retry-after": "2" } })),
      ),
    ),
    Effect.catch((error) =>
      Effect.logWarning("models: the catalog could not be read from opencode", error).pipe(
        Effect.as(HttpServerResponse.jsonUnsafe({ error: "opencode unreachable" }, { status: 502 })),
      ),
    ),
  ),
);
