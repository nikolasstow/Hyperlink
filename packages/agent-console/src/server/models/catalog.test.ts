import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Effect, Layer, Schema } from "effect";
import { FetchHttpClient, HttpRouter } from "effect/http";
import { Models } from "agent-console-protocol";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { modelsRoute } from "./catalog";

const UPSTREAM_PORT = 6100 + Math.floor(Math.random() * 100);
const asked: Array<string> = [];

/** A stand-in for opencode's /config/providers: with keys, as the real one. */
const upstream = createServer((request: IncomingMessage, response: ServerResponse) => {
  asked.push(request.url ?? "");
  response.writeHead(200, { "content-type": "application/json" });
  response.end(
    JSON.stringify({
      providers: [
        { id: "deepseek", name: "DeepSeek", key: "sk-secret", options: { apiKey: "sk-secret" }, models: { "deepseek-v4-pro": { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro", cost: {} } } },
        { id: "opencode", name: "OpenCode", key: "sk-other", models: { "big-pickle": { id: "big-pickle", name: "Big Pickle" }, fable: { id: "fable", name: "Fable" } } },
      ],
      default: { deepseek: "deepseek-v4-pro", opencode: "big-pickle" },
    }),
  );
});

beforeAll(async () => {
  await new Promise<void>((resolve) => upstream.listen(UPSTREAM_PORT, "127.0.0.1", resolve));
  process.env.AGENT_CONSOLE_OPENCODE_URL = `http://127.0.0.1:${UPSTREAM_PORT}`;
});

afterAll(() => {
  if (upstream.listening) upstream.close();
  delete process.env.AGENT_CONSOLE_OPENCODE_URL;
});

describe("GET /models", () => {
  it("streams each configured provider a line, the defaults last, and no keys", async () => {
    const { handler, dispose } = HttpRouter.toWebHandler(modelsRoute, { disableLogger: true });
    // The route takes its HTTP client per request, as the server provides it.
    const context = await Effect.runPromise(Layer.build(FetchHttpClient.layer).pipe(Effect.scoped));
    try {
      const response = await handler(new Request(`http://localhost${Models.path}?directory=${encodeURIComponent("/repo a")}`), context);
      expect(response.headers.get("content-type")).toContain("application/x-ndjson");
      const text = await response.text();
      expect(text).not.toContain("sk-");
      const lines = text
        .split("\n")
        .filter((line) => line.length > 0)
        .map((line) => Schema.decodeUnknownSync(Schema.fromJsonString(Models.Line))(line));
      expect(lines.map((line) => (line._tag === "Provider" ? line.provider.id : "defaults"))).toEqual(["deepseek", "opencode", "defaults"]);
      expect(lines[1]).toEqual({ _tag: "Provider", provider: { id: "opencode", name: "OpenCode", models: [{ id: "big-pickle", name: "Big Pickle" }, { id: "fable", name: "Fable" }] } });
      expect(asked.at(-1)).toBe("/config/providers?directory=%2Frepo%20a");
    } finally {
      await dispose();
    }
  });
});
