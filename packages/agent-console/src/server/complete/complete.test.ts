import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Effect, Layer, Option, Schema, Stream } from "effect";
import { FetchHttpClient, HttpRouter } from "effect/http";
import { Complete } from "agent-console-protocol";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LanguageHost, type PlaceContext } from "../language/host";
import { completeRoute, insertionOf, promptOf } from "./complete";

const UPSTREAM_PORT = 6300 + Math.floor(Math.random() * 100);
const asked: Array<{ readonly url: string; readonly body: unknown }> = [];

/** A stand-in for opencode v2's one-shot generate: answers in a fence, as models sometimes do. */
const upstream = createServer((request: IncomingMessage, response: ServerResponse) => {
  let body = "";
  request.on("data", (chunk: Buffer) => (body += chunk.toString()));
  request.on("end", () => {
    if (request.url === "/api/model") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ data: [{ id: "big-pickle", providerID: "opencode", enabled: true }, { id: "claude-haiku-4-5", providerID: "opencode", enabled: true }] }));
      return;
    }
    asked.push({ url: request.url ?? "", body: JSON.parse(body) });
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ data: { text: "```ts\nvalues.reduce((a, b) => a + b, 0);\n```" } }));
  });
});

beforeAll(async () => {
  await new Promise<void>((resolve) => upstream.listen(UPSTREAM_PORT, "127.0.0.1", resolve));
  process.env.AGENT_CONSOLE_OPENCODE_URL = `http://127.0.0.1:${UPSTREAM_PORT}`;
});

afterAll(() => {
  if (upstream.listening) upstream.close();
  delete process.env.AGENT_CONSOLE_OPENCODE_URL;
});

/** What the language server knows at the caret, in these tests. */
const PLACE: PlaceContext = { signature: "reduce(callback: (a: number, b: number) => number, initial: number): number", names: ["reduce: (callback) => number", "length: number"] };
const knowing = Layer.succeed(LanguageHost, {
  diagnostics: () => Stream.empty,
  hover: () => Effect.succeed(Option.none()),
  contextAt: () => Effect.succeed(PLACE),
});

const request: Complete.Request = { path: "src/math.ts", prefix: "export const sum = (values: number[]) =>\n  ", suffix: "\n", model: { providerID: "opencode", id: "claude-haiku-4-5" } };

describe("POST /complete", () => {
  it("asks opencode's generate with the caret's surroundings and the model, and answers the insertion", async () => {
    const { handler, dispose } = HttpRouter.toWebHandler(completeRoute, { disableLogger: true });
    const context = await Effect.runPromise(Layer.build(Layer.mergeAll(FetchHttpClient.layer, knowing)).pipe(Effect.scoped));
    try {
      const response = await handler(new Request(`http://localhost${Complete.path}`, { method: "POST", body: JSON.stringify(request), headers: { "content-type": "application/json" } }), context);
      expect(Schema.decodeUnknownSync(Schema.fromJsonString(Complete.Response))(await response.text())).toEqual({ text: "values.reduce((a, b) => a + b, 0);" });
      expect(asked[0]?.url).toBe("/api/experimental/generate");
      expect(asked[0]?.body).toEqual({ prompt: promptOf(request, PLACE), model: { providerID: "opencode", id: "claude-haiku-4-5" } });
      expect(promptOf(request, PLACE)).toContain("Names valid at the cursor (prefer these): reduce: (callback) => number; length: number");
    } finally {
      await dispose();
    }
  });
});

describe("POST /complete without a model", () => {
  it("asks with the server's pick (Claude Haiku 4.5), never opencode's own default", async () => {
    const { handler, dispose } = HttpRouter.toWebHandler(completeRoute, { disableLogger: true });
    const context = await Effect.runPromise(Layer.build(Layer.mergeAll(FetchHttpClient.layer, knowing)).pipe(Effect.scoped));
    try {
      asked.length = 0;
      const { model: _model, ...noModel } = request;
      await handler(new Request(`http://localhost${Complete.path}`, { method: "POST", body: JSON.stringify(noModel), headers: { "content-type": "application/json" } }), context);
      expect(asked[0]?.body).toMatchObject({ model: { providerID: "opencode", id: "claude-haiku-4-5" } });
    } finally {
      await dispose();
    }
  });
});

describe("insertionOf", () => {
  it("does not repeat what is already after the caret", () => {
    expect(insertionOf("total + 1);", ");\nreturn")).toBe("total + 1");
  });

  it("stops at a prompt marker the model copied", () => {
    expect(insertionOf("all([a, b]);\n  </CURSOR>", "\n")).toBe("all([a, b]);");
  });

  it("keeps a plain answer, without a trailing newline", () => {
    expect(insertionOf("count += 1;\n", "\n}")).toBe("count += 1;");
  });
});
