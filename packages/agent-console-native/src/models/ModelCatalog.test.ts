import { Effect, Fiber, Layer, Stream } from "effect";
import { FetchHttpClient } from "effect/http";
import * as KeyValueStore from "effect/persistence/KeyValueStore";
import { Models } from "agent-console-protocol";
import { describe, expect, it } from "vitest";
import { type Catalog, ModelCatalog } from "./ModelCatalog";

const provider = (id: string): Models.Provider => ({ id, name: id.toUpperCase(), models: [{ id: `${id}-1`, name: `${id} one` }] });

/** A stand-in server: streams `/models` a line at a time, with a pause between. */
const fakeServer = (providers: ReadonlyArray<Models.Provider>, asked: Array<string>) => (input: RequestInfo | URL): Promise<Response> => {
  asked.push(input instanceof Request ? input.url : String(input));
  const lines = [...providers.map((each) => ({ _tag: "Provider", provider: each })), { _tag: "Defaults", defaults: { [providers[0]?.id ?? "x"]: `${providers[0]?.id ?? "x"}-1` } }];
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const line of lines) {
        controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`));
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      controller.close();
    },
  });
  return Promise.resolve(new Response(body, { headers: { "content-type": "application/x-ndjson" } }));
};

const catalogOver = (fetch: (input: RequestInfo | URL) => Promise<Response>) =>
  Layer.fresh(ModelCatalog.layer).pipe(Layer.provide(FetchHttpClient.layer.pipe(Layer.provide(Layer.succeed(FetchHttpClient.Fetch)(fetch)))));

/** Every state a folder's catalog passes through while `effect` runs. */
const watching = <A, E>(key: string, effect: Effect.Effect<A, E, ModelCatalog>) =>
  Effect.gen(function* () {
    const seen: Array<Catalog | undefined> = [];
    const watcher = yield* (yield* ModelCatalog).changes.pipe(
      Stream.runForEach((all) => Effect.sync(() => seen.push(all[key]))),
      Effect.forkChild,
    );
    yield* Effect.sleep("10 millis");
    yield* effect;
    yield* Effect.sleep("10 millis");
    yield* Fiber.interrupt(watcher);
    return seen;
  });

describe("ModelCatalog", () => {
  it("with nothing kept, fills in a provider at a time, then keeps it for the next run", async () => {
    const asked: Array<string> = [];
    const fetch = fakeServer([provider("deepseek"), provider("opencode"), provider("digitalocean")], asked);
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const seen = yield* watching("/repo", ModelCatalog.pipe(Effect.flatMap((catalog) => catalog.refresh("http://server", "/repo")))).pipe(Effect.provide(catalogOver(fetch)));
        const next = yield* Effect.gen(function* () {
          const catalog = yield* ModelCatalog;
          yield* catalog.readBack;
          return (yield* catalog.changes.pipe(Stream.take(1), Stream.runCollect))[0]?.["/repo"];
        }).pipe(Effect.provide(catalogOver(fetch)));
        return { seen, next };
      }).pipe(Effect.provide(KeyValueStore.layerMemory)),
    );
    const sizes = result.seen.flatMap((catalog) => (catalog === undefined ? [] : [`${catalog.providers.length}${catalog.complete ? "✓" : ""}`]));
    expect(sizes).toEqual(["1", "2", "3", "3✓"]);
    expect(result.next?.providers.map((each) => each.id)).toEqual(["deepseek", "opencode", "digitalocean"]);
    expect(result.next?.defaults).toEqual({ deepseek: "deepseek-1" });
    expect(asked).toEqual([`http://server${Models.path}?directory=%2Frepo`]);
  });

  it("with a list kept, shows it until the fresh one is complete", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        yield* ModelCatalog.pipe(Effect.flatMap((catalog) => catalog.refresh("http://server", undefined))).pipe(Effect.provide(catalogOver(fakeServer([provider("old")], []))));
        return yield* Effect.gen(function* () {
          yield* (yield* ModelCatalog).readBack;
          return yield* watching("", ModelCatalog.pipe(Effect.flatMap((catalog) => catalog.refresh("http://server", undefined))));
        }).pipe(Effect.provide(catalogOver(fakeServer([provider("a"), provider("b")], []))));
      }).pipe(Effect.provide(KeyValueStore.layerMemory)),
    );
    const shown = result.flatMap((catalog) => (catalog === undefined ? [] : [catalog.providers.map((each) => each.id).join("+")]));
    expect(shown).toEqual(["old", "a+b"]);
  });

  it("refreshes the server's own list and every folder it knows", async () => {
    const asked: Array<string> = [];
    await Effect.runPromise(
      Effect.gen(function* () {
        const catalog = yield* ModelCatalog;
        yield* catalog.refresh("http://server", "/a");
        asked.length = 0;
        yield* catalog.refreshAll("http://server");
      }).pipe(Effect.provide(catalogOver(fakeServer([provider("p")], asked))), Effect.provide(KeyValueStore.layerMemory)),
    );
    expect([...asked].sort()).toEqual([`http://server${Models.path}`, `http://server${Models.path}?directory=%2Fa`]);
  });
});
