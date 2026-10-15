import { Effect, Fiber, Layer, Stream } from "effect";
import { FetchHttpClient } from "effect/http";
import * as KeyValueStore from "effect/persistence/KeyValueStore";
import { Commands } from "agent-console-protocol";
import { describe, expect, it } from "vitest";
import { Opencode } from "../opencode/Opencode";
import { ServerAddress } from "../opencode/serverAddress";
import { CommandCatalog } from "./CommandCatalog";

const entry = (name: string): Commands.Entry => ({ id: `skill:${name}`, name, source: "skill" });

const OPENCODE = ServerAddress.make("http://server/opencode");

/** A stand-in server: `/commands` answers with the next list in `answers`
 * (the last one again when they run out); opencode's event stream sends
 * `events` and stays open. */
const fakeServer = (answers: ReadonlyArray<ReadonlyArray<Commands.Entry>>, asked: Array<string>, events: ReadonlyArray<unknown> = []) => {
  let answered = 0;
  return (input: RequestInfo | URL): Promise<Response> => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.startsWith(`${OPENCODE}/api/event`)) {
      const encoder = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          for (const event of events) controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        },
      });
      return Promise.resolve(new Response(body, { headers: { "content-type": "text/event-stream" } }));
    }
    asked.push(url);
    const list = answers[Math.min(answered, answers.length - 1)] ?? [];
    answered += 1;
    return Promise.resolve(Response.json(list));
  };
};

const catalogOver = (fetch: (input: RequestInfo | URL) => Promise<Response>) => {
  const http = FetchHttpClient.layer.pipe(Layer.provide(Layer.succeed(FetchHttpClient.Fetch)(fetch)));
  return Layer.fresh(CommandCatalog.layer).pipe(Layer.provide(Layer.mergeAll(http, Opencode.layer.pipe(Layer.provide(http)))));
};

const changed = (type: string, directory: string) => ({ id: `evt_${type}${directory}`, created: 1, type, location: { directory }, data: {} });

describe("CommandCatalog", () => {
  it("keeps a folder's list for the next run", async () => {
    const asked: Array<string> = [];
    const fetch = fakeServer([[entry("unslop"), entry("review")]], asked);
    const kept = await Effect.runPromise(
      Effect.gen(function* () {
        yield* CommandCatalog.pipe(Effect.flatMap((catalog) => catalog.refresh("http://server", "/repo"))).pipe(Effect.provide(catalogOver(fetch)));
        return yield* Effect.gen(function* () {
          const catalog = yield* CommandCatalog;
          yield* catalog.readBack;
          return (yield* catalog.changes.pipe(Stream.take(1), Stream.runCollect))[0]?.["/repo"];
        }).pipe(Effect.provide(catalogOver(fetch)));
      }).pipe(Effect.provide(KeyValueStore.layerMemory)),
    );
    expect(kept?.map((each) => each.name)).toEqual(["unslop", "review"]);
    expect(asked).toEqual([`http://server${Commands.path}?directory=%2Frepo`]);
  });

  it("refreshes the server's own list and every folder it knows", async () => {
    const asked: Array<string> = [];
    await Effect.runPromise(
      Effect.gen(function* () {
        const catalog = yield* CommandCatalog;
        yield* catalog.refresh("http://server", "/a");
        asked.length = 0;
        yield* catalog.refreshAll("http://server");
      }).pipe(Effect.provide(catalogOver(fakeServer([[entry("x")]], asked))), Effect.provide(KeyValueStore.layerMemory)),
    );
    expect([...asked].sort()).toEqual([`http://server${Commands.path}`, `http://server${Commands.path}?directory=%2Fa`]);
  });

  it("fetches a known folder again, once, when opencode says its commands and skills changed", async () => {
    const asked: Array<string> = [];
    // The first answer is short: opencode had not loaded the folder's skills yet.
    const events = [changed("command.updated", "/repo"), changed("skill.updated", "/repo"), changed("skill.updated", "/elsewhere"), { ...changed("session.idle", "/repo"), data: { sessionID: "ses_1" } }];
    const fetch = fakeServer([[], [entry("unslop")]], asked, events);
    const list = await Effect.runPromise(
      Effect.gen(function* () {
        const catalog = yield* CommandCatalog;
        yield* catalog.refresh("http://server", "/repo");
        const following = yield* Effect.forkChild(catalog.follow("http://server", OPENCODE));
        yield* Effect.sleep("400 millis");
        yield* Fiber.interrupt(following);
        return (yield* catalog.changes.pipe(Stream.take(1), Stream.runCollect))[0]?.["/repo"];
      }).pipe(Effect.provide(catalogOver(fetch)), Effect.provide(KeyValueStore.layerMemory)),
    );
    expect(list?.map((each) => each.name)).toEqual(["unslop"]);
    expect(asked).toEqual([`http://server${Commands.path}?directory=%2Frepo`, `http://server${Commands.path}?directory=%2Frepo`]);
  });
});
