import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Effect, Layer, Schema } from "effect";
import { FetchHttpClient, HttpRouter } from "effect/http";
import { Complete } from "agent-console-protocol";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { completeRoute, insertionOf, promptOf } from "./complete";

const UPSTREAM_PORT = 6300 + Math.floor(Math.random() * 100);
const asked: Array<{ readonly url: string; readonly body: unknown }> = [];

/** A stand-in for opencode v2's one-shot generate: answers in a fence, as models sometimes do. */
const upstream = createServer((request: IncomingMessage, response: ServerResponse) => {
  let body = "";
  request.on("data", (chunk: Buffer) => (body += chunk.toString()));
  request.on("end", () => {
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

const request: Complete.Request = { path: "src/math.ts", prefix: "export const sum = (values: number[]) =>\n  ", suffix: "\n", model: { providerID: "opencode", id: "claude-haiku-4-5" } };

describe("POST /complete", () => {
  it("asks opencode's generate with the caret's surroundings and the model, and answers the insertion", async () => {
    const { handler, dispose } = HttpRouter.toWebHandler(completeRoute, { disableLogger: true });
    const context = await Effect.runPromise(Layer.build(FetchHttpClient.layer).pipe(Effect.scoped));
    try {
      const response = await handler(new Request(`http://localhost${Complete.path}`, { method: "POST", body: JSON.stringify(request), headers: { "content-type": "application/json" } }), context);
      expect(Schema.decodeUnknownSync(Schema.fromJsonString(Complete.Response))(await response.text())).toEqual({ text: "values.reduce((a, b) => a + b, 0);" });
      expect(asked[0]?.url).toBe("/api/experimental/generate");
      expect(asked[0]?.body).toEqual({ prompt: promptOf(request), model: { providerID: "opencode", id: "claude-haiku-4-5" } });
    } finally {
      await dispose();
    }
  });
});

describe("insertionOf", () => {
  it("does not repeat what is already after the caret", () => {
    expect(insertionOf("total + 1);", ");\nreturn")).toBe("total + 1");
  });

  it("keeps a plain answer, without a trailing newline", () => {
    expect(insertionOf("count += 1;\n", "\n}")).toBe("count += 1;");
  });
});
