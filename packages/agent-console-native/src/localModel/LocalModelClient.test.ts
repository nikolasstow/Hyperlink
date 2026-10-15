import { Effect, Layer, Option, Stream } from "effect";
import { FetchHttpClient } from "effect/http";
import type { LocalModel } from "agent-console-protocol";
import { describe, expect, it } from "vitest";
import { LocalModelClient } from "./LocalModelClient";

/** A stand-in API server: answers every local-model call with its overview,
 * taking the settings a PUT sends. */
const fakeServer = (asked: Array<string>) => {
  let settings: LocalModel.Settings = { enabled: true, model: "qwen2.5-coder-7b-q4" };
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    asked.push(`${request.method} ${request.url}`);
    if (request.method === "PUT") settings = await request.json();
    const overview: LocalModel.Overview = { settings, status: settings.enabled ? { state: "starting", model: settings.model } : { state: "off", model: settings.model } };
    return Response.json(overview);
  };
};

const clientOver = (fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) =>
  LocalModelClient.layer.pipe(Layer.provide(FetchHttpClient.layer.pipe(Layer.provide(Layer.succeed(FetchHttpClient.Fetch)(fetch)))));

describe("LocalModelClient", () => {
  it("keeps the overview each call answers", async () => {
    const asked: Array<string> = [];
    const kept = await Effect.runPromise(
      Effect.gen(function* () {
        const client = yield* LocalModelClient;
        yield* client.refresh("http://server");
        yield* client.setSettings("http://server", { enabled: false, model: "qwen2.5-coder-3b" });
        return (yield* client.changes.pipe(Stream.take(1), Stream.runCollect))[0];
      }).pipe(Effect.provide(clientOver(fakeServer(asked)))),
    );
    expect(asked).toEqual(["GET http://server/local-model", "PUT http://server/local-model/settings"]);
    expect(kept).toEqual(Option.some({ settings: { enabled: false, model: "qwen2.5-coder-3b" }, status: { state: "off", model: "qwen2.5-coder-3b" } }));
  });
});
