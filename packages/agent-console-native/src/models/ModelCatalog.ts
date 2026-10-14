/**
 * The model catalog: each folder's configured providers and their models, as
 * the server streams them (`GET /models`, agent-console-protocol `Models`),
 * kept on the device and read back at launch, so a model picker has its list
 * before it opens.
 *
 * Loaded ahead: at app open and on return to the foreground, every folder
 * known (and the server's own, `""`) is fetched again (ModelCatalogSync).
 * A folder with nothing kept fills in a provider at a time as the lines come;
 * one with a kept list keeps showing it until the fresh one is complete.
 *
 * @internal
 */
import { Context, Effect, Layer, Option, Schema, Stream, SubscriptionRef } from "effect";
import { Ndjson } from "effect/encoding";
import { HttpClient, HttpClientResponse } from "effect/http";
import * as KeyValueStore from "effect/persistence/KeyValueStore";
import { Models } from "agent-console-protocol";

const STORE_KEY = "catalogs";

/** A folder's catalog: its providers, and each provider's default model. */
export const Catalog = Schema.Struct({
  providers: Schema.Array(Models.Provider),
  defaults: Schema.Record(Schema.String, Schema.String),
  /** False while the lines are still coming. */
  complete: Schema.Boolean,
});
export type Catalog = typeof Catalog.Type;

/** The catalogs kept on the device, by folder (`""`: the server's own). */
const Catalogs = Schema.Record(Schema.String, Catalog);
type Catalogs = typeof Catalogs.Type;

/** The key a folder's catalog is kept under. */
export const folderKey = (directory: string | undefined): string => directory ?? "";

const make = Effect.gen(function* () {
  const store = KeyValueStore.toSchemaStore(yield* KeyValueStore.KeyValueStore, Catalogs);
  const http = yield* HttpClient.HttpClient;
  const catalogs = yield* SubscriptionRef.make<Catalogs>({});

  const keep = (next: Catalogs) =>
    store.set(
      STORE_KEY,
      Object.fromEntries(Object.entries(next).filter(([, catalog]) => catalog.complete)),
    ).pipe(Effect.catch((error) => Effect.logError("[models] keeping the catalogs failed", error)));

  const put = (key: string, catalog: Catalog) => SubscriptionRef.update(catalogs, (all) => ({ ...all, [key]: catalog }));

  /** Fetches one folder's catalog from `server`, line by line. */
  const refresh = (server: string, directory: string | undefined) =>
    Effect.gen(function* () {
      const key = folderKey(directory);
      const before = (yield* SubscriptionRef.get(catalogs))[key];
      // Shown as it comes only when there is nothing to show yet.
      const progressive = before === undefined || !before.complete;
      const query = directory === undefined ? "" : `?directory=${encodeURIComponent(directory)}`;
      const response = yield* http.get(`${server}${Models.path}${query}`).pipe(Effect.flatMap(HttpClientResponse.filterStatusOk));
      const fresh = yield* response.stream.pipe(
        Stream.decodeText,
        Stream.pipeThroughChannel(Ndjson.decodeSchemaString(Models.Line)({ ignoreEmptyLines: true })),
        Stream.runFoldEffect(
          (): Catalog => ({ providers: [], defaults: {}, complete: false }),
          (catalog, line) => {
            const next: Catalog =
              line._tag === "Provider"
                ? { ...catalog, providers: [...catalog.providers, line.provider] }
                : { ...catalog, defaults: line.defaults };
            // Each provider shown as it comes; the defaults come with the whole.
            return progressive && line._tag === "Provider" ? put(key, next).pipe(Effect.as(next)) : Effect.succeed(next);
          },
        ),
      );
      yield* put(key, { ...fresh, complete: true });
      yield* keep(yield* SubscriptionRef.get(catalogs));
    }).pipe(Effect.catch((error) => Effect.logWarning(`[models] the catalog of ${directory ?? "the server"} could not be loaded`, error)));

  return {
    /** Every folder's catalog, as it changes. */
    changes: SubscriptionRef.changes(catalogs),
    /** Reads back the catalogs kept on the device (at launch). */
    readBack: store.get(STORE_KEY).pipe(
      Effect.map(Option.getOrElse((): Catalogs => ({}))),
      Effect.flatMap((kept) => SubscriptionRef.set(catalogs, kept)),
      Effect.catch((error) => Effect.logError("[models] the kept catalogs could not be read", error)),
    ),
    /** Fetches one folder's catalog again. */
    refresh,
    /** Fetches every known folder's catalog again, and the server's own. */
    refreshAll: (server: string) =>
      Effect.flatMap(SubscriptionRef.get(catalogs), (all) =>
        Effect.forEach(
          [...new Set(["", ...Object.keys(all)])],
          (key) => refresh(server, key === "" ? undefined : key),
          { concurrency: 2, discard: true },
        ),
      ),
  };
});

export class ModelCatalog extends Context.Service<ModelCatalog, Effect.Success<typeof make>>()("@doubleagent/ModelCatalog") {
  static readonly layer = Layer.effect(ModelCatalog, make);
}
