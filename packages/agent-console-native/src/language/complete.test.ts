import { Effect, Layer, Stream } from "effect";
import { FetchHttpClient } from "effect/http";
import { Complete } from "agent-console-protocol";
import { describe, expect, it } from "vitest";
import { InlineSuggestions } from "./complete";

/** A stand-in API server: `/complete` streams `blocks` (server-sent events
 * text), each sent on its own, as the server writes them. */
const serverSending = (blocks: ReadonlyArray<string>, asked: Array<unknown>) => (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const sent = init?.body;
  asked.push({ url: input instanceof Request ? input.url : String(input), body: typeof sent === "string" ? JSON.parse(sent) : sent instanceof Uint8Array ? JSON.parse(new TextDecoder().decode(sent)) : sent });
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const block of blocks) controller.enqueue(encoder.encode(block));
      controller.close();
    },
  });
  return Promise.resolve(new Response(body, { headers: { "content-type": "text/event-stream" } }));
};

const suggestionsFrom = (blocks: ReadonlyArray<string>, asked: Array<unknown>) =>
  InlineSuggestions.pipe(
    Effect.flatMap((suggestions) => Stream.runCollect(suggestions.at("http://server", "/r/a.ts", "const a = 1;\nconst b = ", 23, undefined))),
    Effect.provide(InlineSuggestions.layer.pipe(Layer.provide(FetchHttpClient.layer.pipe(Layer.provide(Layer.succeed(FetchHttpClient.Fetch)(serverSending(blocks, asked))))))),
  );

describe("InlineSuggestions", () => {
  it("gives the suggestion as it grows, with the text either side of the caret", async () => {
    const asked: Array<unknown> = [];
    const grown = await Effect.runPromise(
      suggestionsFrom([`data: ${JSON.stringify({ text: "a" })}\n\n`, `data: ${JSON.stringify({ text: "a + 1" })}\n\n`, `data: ${JSON.stringify({ text: "a + 1;" })}\n\n`], asked),
    );
    expect(grown).toEqual(["a", "a + 1", "a + 1;"]);
    expect(asked).toEqual([{ url: `http://server${Complete.path}`, body: { path: "/r/a.ts", prefix: "const a = 1;\nconst b = ", suffix: "" } }]);
  });

  it("fails with why, when the server says there is none", async () => {
    const error = await Effect.runPromise(suggestionsFrom([`event: ${Complete.errorEvent}\ndata: the local model answered 500\n\n`], []).pipe(Effect.flip));
    expect(error._tag === "NoSuggestion" ? error.reason : error._tag).toBe("the local model answered 500");
  });
});
