import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Effect, Layer, Schema } from "effect";
import { FetchHttpClient, HttpRouter } from "effect/http";
import { Models } from "agent-console-protocol";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { modelsRoute } from "./catalog";

const UPSTREAM_PORT = 6100 + Math.floor(Math.random() * 100);
const asked: Array<string> = [];

const model = (providerID: string, id: string, name: string, enabled = true) => ({ id, modelID: id, providerID, name, enabled, settings: { apiKey: "sk-secret" } });

/** A stand-in for opencode v2's provider and model routes: with keys, as the real one. */
const upstream = createServer((request: IncomingMessage, response: ServerResponse) => {
  asked.push(request.url ?? "");
  const path = new URL(request.url ?? "/", "http://localhost").pathname;
  const body =
    path === "/api/provider"
      ? { data: [{ id: "deepseek", name: "DeepSeek", settings: { apiKey: "sk-secret" } }, { id: "opencode", name: "OpenCode" }, { id: "idle", name: "No models" }] }
      : path === "/api/model"
        ? {
            data: [
              model("deepseek", "deepseek-v4-pro", "DeepSeek V4 Pro"),
              model("opencode", "big-pickle", "Big Pickle"),
              model("opencode", "old", "Old", false),
              model("opencode", "fable", "Fable"),
            ],
          }
        : { data: model("opencode", "big-pickle", "Big Pickle") };
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify({ location: { directory: "/repo a" }, ...body }));
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
  it("streams each provider with enabled models a line, the default last, and no keys", async () => {
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
      expect(lines.at(-1)).toEqual({ _tag: "Defaults", defaults: { opencode: "big-pickle" } });
      expect([...asked].sort()).toEqual(["/api/model", "/api/model/default", "/api/provider"].map((path) => `${path}?location%5Bdirectory%5D=%2Frepo+a`).sort());
    } finally {
      await dispose();
    }
  });
});
