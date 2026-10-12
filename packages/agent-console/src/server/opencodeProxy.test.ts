import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { NodeHttpServer } from "@effect/platform-node";
import { Duration, Effect, Fiber, Layer } from "effect";
import { FetchHttpClient, HttpRouter } from "effect/unstable/http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { opencodeProxyRoute } from "./opencodeProxy";

const UPSTREAM_PORT = 5800 + Math.floor(Math.random() * 100);
const PROXY_PORT = 5900 + Math.floor(Math.random() * 100);
const proxy = `http://127.0.0.1:${PROXY_PORT}`;

/** A stand-in for opencode: echoes requests, and streams server-sent events. */
const upstream = createServer((request: IncomingMessage, response: ServerResponse) => {
  if (request.url?.startsWith("/global/event")) {
    response.writeHead(200, {
      "content-type": "text/event-stream",
    });
    let sent = 0;
    const tick = setInterval(() => {
      sent += 1;
      response.write(`data: {"n":${sent}}\n\n`);
      if (sent === 3) {
        clearInterval(tick);
        response.end();
      }
    }, 150);
    return;
  }
  let body = "";
  request.on("data", (chunk: Buffer) => {
    body += chunk.toString();
  });
  request.on("end", () => {
    response.writeHead(201, {
      "content-type": "application/json",
      "x-upstream": "yes",
    });
    response.end(
      JSON.stringify({
        method: request.method,
        url: request.url,
        directory: request.headers["x-opencode-directory"] ?? null,
        body,
      }),
    );
  });
});

let stop: (() => void) | undefined;

beforeAll(async () => {
  await new Promise<void>((resolve) => upstream.listen(UPSTREAM_PORT, "127.0.0.1", resolve));
  process.env.AGENT_CONSOLE_OPENCODE_URL = `http://127.0.0.1:${UPSTREAM_PORT}`;
  const fiber = Effect.runFork(
    Layer.launch(
      HttpRouter.serve(opencodeProxyRoute).pipe(
        Layer.provide(FetchHttpClient.layer),
        Layer.provide(NodeHttpServer.layer(createServer, { port: PROXY_PORT })),
      ),
    ),
  );
  stop = () => {
    Effect.runFork(Fiber.interrupt(fiber));
  };
  await Effect.runPromise(Effect.sleep(Duration.millis(300)));
});

afterAll(() => {
  stop?.();
  if (upstream.listening) upstream.close();
  delete process.env.AGENT_CONSOLE_OPENCODE_URL;
});

describe("opencode forward", () => {
  it("forwards the method, path, query, headers and body, and the response's status and headers", async () => {
    const response = await fetch(`${proxy}/opencode/session/abc/message?limit=2`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-opencode-directory": "/repo",
      },
      body: JSON.stringify({ text: "hi" }),
    });
    expect(response.status).toBe(201);
    expect(response.headers.get("x-upstream")).toBe("yes");
    expect(await response.json()).toEqual({
      method: "POST",
      url: "/session/abc/message?limit=2",
      directory: "/repo",
      body: '{"text":"hi"}',
    });
  });

  it("forwards a GET with no body", async () => {
    const response = await fetch(`${proxy}/opencode/session`);
    expect(await response.json()).toMatchObject({
      method: "GET",
      url: "/session",
      body: "",
    });
  });

  it("streams server-sent events as they come, not at the end", async () => {
    const response = await fetch(`${proxy}/opencode/global/event`);
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    const reader = response.body?.getReader();
    if (reader === undefined) return expect(reader).toBeDefined();
    const decoder = new TextDecoder();
    const started = Date.now();
    const first = await reader.read();
    // The first event arrives well before the stream ends (3 events, 150ms apart).
    expect(Date.now() - started).toBeLessThan(400);
    expect(decoder.decode(first.value)).toContain('"n":1');
    let rest = "";
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      rest += decoder.decode(chunk.value);
    }
    expect(rest).toContain('"n":3');
  });

  // Last: it takes the stand-in down.
  it("answers 502 when opencode is down", async () => {
    upstream.closeAllConnections();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
    const response = await fetch(`${proxy}/opencode/session`);
    expect(response.status).toBe(502);
  });
});
