import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Effect, Layer, Schema } from "effect";
import { FetchHttpClient, HttpRouter } from "effect/http";
import { Commands } from "agent-console-protocol";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { commandsRoute } from "./catalog";

const UPSTREAM_PORT = 6200 + Math.floor(Math.random() * 100);
const asked: Array<string> = [];

/** A stand-in for opencode v2's command and skill routes: skills with their text, as the real one. */
const upstream = createServer((request: IncomingMessage, response: ServerResponse) => {
  asked.push(request.url ?? "");
  const path = new URL(request.url ?? "/", "http://localhost").pathname;
  const body =
    path === "/api/command"
      ? { data: [{ name: "review", description: "Review the changes" }] }
      : {
          data: [
            { id: "unslop", name: "Unslop", description: "Remove AI writing patterns", path: "/s/unslop/SKILL.md", content: "SECRET SKILL TEXT" },
            { id: "notify-phone", name: "notify-phone", path: "/s/notify/SKILL.md", content: "SECRET SKILL TEXT" },
            { id: "opencode", name: "OpenCode", description: "About opencode", path: "/builtin/opencode.md", content: "SECRET SKILL TEXT" },
          ],
        };
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

describe("GET /commands", () => {
  it("sends commands and skills as one list by name, with each skill's file but not its text", async () => {
    const { handler, dispose } = HttpRouter.toWebHandler(commandsRoute, { disableLogger: true });
    const context = await Effect.runPromise(Layer.build(FetchHttpClient.layer).pipe(Effect.scoped));
    try {
      const response = await handler(new Request(`http://localhost${Commands.path}?directory=${encodeURIComponent("/repo a")}`), context);
      const text = await response.text();
      expect(text).not.toContain("SECRET");
      expect(Schema.decodeUnknownSync(Schema.fromJsonString(Commands.List))(text)).toEqual([
        { id: "skill:notify-phone", name: "notify-phone", source: "skill", path: "/s/notify/SKILL.md" },
        { id: "skill:opencode", name: "opencode", description: "About opencode", source: "skill" },
        { id: "command:review", name: "review", description: "Review the changes", source: "command" },
        { id: "skill:unslop", name: "unslop", description: "Remove AI writing patterns", source: "skill", path: "/s/unslop/SKILL.md" },
      ]);
      expect([...asked].sort()).toEqual(["/api/command", "/api/skill"].map((path) => `${path}?location%5Bdirectory%5D=%2Frepo+a`));
    } finally {
      await dispose();
    }
  });
});
