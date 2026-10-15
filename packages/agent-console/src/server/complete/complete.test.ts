import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Effect, Layer, Option, Schema, Stream } from "effect";
import { FetchHttpClient, HttpRouter } from "effect/http";
import { Complete } from "agent-console-protocol";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FileHub } from "../files/hub";
import { LanguageHost, type PlaceContext } from "../language/host";
import { LocalModel } from "../localModel/LocalModel";
import { completeRoute, fitsAt, insertionOf, promptOf } from "./complete";
import { snippetsFor } from "./snippets";

const UPSTREAM_PORT = 6300 + Math.floor(Math.random() * 100);
const asked: Array<{ readonly url: string; readonly body: unknown }> = [];
/** Whether the local model is ready. */
let localUp = false;

/** A stand-in for opencode v2's one-shot generate: answers in a fence, as models sometimes do. */
const upstream = createServer((request: IncomingMessage, response: ServerResponse) => {
  let body = "";
  request.on("data", (chunk: Buffer) => (body += chunk.toString()));
  request.on("end", () => {
    if (request.url === "/infill") {
      asked.push({ url: request.url, body: JSON.parse(body) });
      response.writeHead(200, { "content-type": "application/json" });
      // A fill-in-the-middle model writes on past the line: shaping keeps one.
      response.end(JSON.stringify({ content: "values.reduce((a, b) => a + b, 0);\nconst more = 1;" }));
      return;
    }
    if (request.url === "/api/model") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ data: [{ id: "big-pickle", providerID: "opencode", enabled: true }, { id: "claude-haiku-4-5", providerID: "opencode", enabled: true }] }));
      return;
    }
    asked.push({ url: request.url ?? "", body: JSON.parse(body) });
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ data: { text: "Sure:\n<INSERT>```ts\nvalues.reduce((a, b) => a + b, 0);\n```</INSERT>" } }));
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
const knowing = Layer.mergeAll(
  Layer.succeed(LanguageHost, {
    diagnostics: () => Stream.empty,
    hover: () => Effect.succeed(Option.none()),
    contextAt: () => Effect.succeed(PLACE),
  }),
  // One other file open: its sum helper is like the code at the caret.
  Layer.succeed(FileHub, {
    follow: () => Stream.empty,
    write: () => Effect.die("not written in these tests"),
    openFiles: Effect.succeed([{ path: "/r/helpers.ts", text: "export const sumValues = (values: number[]) => values.reduce((a, b) => a + b, 0);" }]),
  }),
  // The local model: the stand-in server, ready when `localUp`.
  Layer.succeed(LocalModel, {
    url: `http://127.0.0.1:${UPSTREAM_PORT}`,
    ready: Effect.sync(() => localUp),
    overview: Effect.die("not read in these tests"),
    setSettings: () => Effect.die("not set in these tests"),
    install: Effect.die("not installed in these tests"),
    restart: Effect.die("not restarted in these tests"),
  }),
);

const request: Complete.Request = { path: "src/math.ts", prefix: "export const sum = (values: number[]) =>\n  ", suffix: "\n", model: { providerID: "opencode", id: "claude-haiku-4-5" } };

describe("POST /complete", () => {
  it("asks opencode's generate with the caret's surroundings and the model, and answers the insertion", async () => {
    const { handler, dispose } = HttpRouter.toWebHandler(completeRoute, { disableLogger: true });
    const context = await Effect.runPromise(Layer.build(Layer.mergeAll(FetchHttpClient.layer, knowing)).pipe(Effect.scoped));
    try {
      const response = await handler(new Request(`http://localhost${Complete.path}`, { method: "POST", body: JSON.stringify(request), headers: { "content-type": "application/json" } }), context);
      expect(Schema.decodeUnknownSync(Schema.fromJsonString(Complete.Response))(await response.text())).toEqual({ text: "values.reduce((a, b) => a + b, 0);" });
      expect(asked[0]?.url).toBe("/api/experimental/generate");
      const near = snippetsFor(request.path, request.prefix, [{ path: "/r/helpers.ts", text: "export const sumValues = (values: number[]) => values.reduce((a, b) => a + b, 0);" }]);
      expect(near.length).toBe(1);
      expect(asked[0]?.body).toEqual({ prompt: promptOf(request, PLACE, near), model: { providerID: "opencode", id: "claude-haiku-4-5" } });
      expect(promptOf(request, PLACE)).toContain("Names valid at the cursor (prefer these): reduce: (callback) => number; length: number");
    } finally {
      await dispose();
    }
  });
});

describe("POST /complete with the local model up", () => {
  it("asks it to fill in the middle, with the open files' chunks, greedy, and keeps one line mid-line", async () => {
    const { handler, dispose } = HttpRouter.toWebHandler(completeRoute, { disableLogger: true });
    const context = await Effect.runPromise(Layer.build(Layer.mergeAll(FetchHttpClient.layer, knowing)).pipe(Effect.scoped));
    localUp = true;
    try {
      asked.length = 0;
      const { model: _model, ...noModel } = request;
      const response = await handler(new Request(`http://localhost${Complete.path}`, { method: "POST", body: JSON.stringify({ ...noModel, prefix: "const total = sumValues(values) + ", suffix: "\n" }), headers: { "content-type": "application/json" } }), context);
      expect(await response.json()).toEqual({ text: "values.reduce((a, b) => a + b, 0);" });
      expect(asked[0]?.url).toBe("/infill");
      expect(asked[0]?.body).toMatchObject({ input_prefix: "const total = sumValues(values) + ", input_suffix: "\n", stop: ["\n"], temperature: 0, top_k: 1, cache_prompt: true });
      expect(JSON.stringify(asked[0]?.body)).toContain("/r/helpers.ts");
      // Not the language server's names (they change at every caret, and would
      // make it read the whole prompt again).
      expect(JSON.stringify(asked[0]?.body)).not.toContain("Names valid at the cursor");
    } finally {
      localUp = false;
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
    expect(insertionOf("<INSERT>total + 1);</INSERT>", ");\nreturn")).toBe("total + 1");
  });

  it("is nothing when the model answers in words, or says nothing fits", () => {
    expect(insertionOf("Wait, looking at the cursor position more carefully - the line already has `Math.max(0, c `", "- l);")).toBe("");
    expect(insertionOf("<INSERT></INSERT>", "- l);")).toBe("");
  });

  it("stops at a prompt marker the model copied", () => {
    expect(insertionOf("<INSERT>all([a, b]);\n  </CURSOR></INSERT>", "\n")).toBe("all([a, b]);");
  });

  it("keeps a plain answer, without a trailing newline", () => {
    expect(insertionOf("<INSERT>count += 1;\n</INSERT>", "\n}")).toBe("count += 1;");
  });
});

describe("fitsAt", () => {
  it("fits at a line's end, or before only closers", () => {
    expect(fitsAt("\nnext line")).toBe(true);
    expect(fitsAt(");\n")).toBe(true);
    expect(fitsAt(" }\n")).toBe(true);
  });

  it("does not fit mid-line, before code", () => {
    expect(fitsAt("- l);\n")).toBe(false);
    expect(fitsAt("value)\n")).toBe(false);
  });
});
