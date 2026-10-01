import { Effect, Layer, Stream } from "effect";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";
import { KeyValueStore } from "effect/unstable/persistence";
import { describe, expect, it } from "vitest";
import { DeviceSignals } from "../effect/DeviceSignals";
import { Opencode } from "../opencode/Opencode";
import { serverAddressOf } from "../opencode/serverAddress";
import { Agent } from "../opencode/schema/agent";
import { AbsolutePath } from "../opencode/schema/schema";
import { SessionID } from "../opencode/schema/session-id";
import { Folders } from "./Folders";
import { Outbox } from "./Outbox";
import { Reachability } from "./Reachability";

const server = serverAddressOf("localhost:4096");
const directory = AbsolutePath.make("/work/repo");

/** A fake opencode v2 server: sessions it made, prompts it admitted (in
 * order), and how it answers a given message text. */
const fakeServer = (answer: (text: string, attempt: number) => "admit" | "refuse" | "fail", sessions = new Set<string>()) => {
  const admitted: Array<string> = [];
  const attempts = new Map<string, number>();
  const json = (request: Parameters<typeof HttpClientResponse.fromWeb>[0], status: number, body: unknown) =>
    HttpClientResponse.fromWeb(request, new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
  const client = HttpClient.make((request, url) =>
    Effect.gen(function* () {
      const path = url.pathname;
      const body: unknown = request.body._tag === "Uint8Array" ? JSON.parse(new TextDecoder().decode(request.body.body)) : undefined;
      if (path === "/api/health") return json(request, 200, { healthy: true });
      if (request.method === "POST" && path === "/api/session") {
        const id = typeof body === "object" && body !== null && "id" in body && typeof body.id === "string" ? body.id : "ses_unknown";
        sessions.add(id);
        return json(request, 200, {
          data: { id, projectID: "global", cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }, time: { created: 1, updated: 1 }, title: "t", location: { directory } },
        });
      }
      const prompt = /^\/api\/session\/([^/]+)\/prompt$/.exec(path);
      if (request.method === "POST" && prompt !== null) {
        const sessionID = prompt[1] ?? "";
        if (!sessions.has(sessionID)) return json(request, 404, { _tag: "SessionNotFoundError", sessionID, message: "not found" });
        const payload = typeof body === "object" && body !== null ? body : {};
        const text = "prompt" in payload && typeof payload.prompt === "object" && payload.prompt !== null && "text" in payload.prompt && typeof payload.prompt.text === "string" ? payload.prompt.text : "";
        const attempt = (attempts.get(text) ?? 0) + 1;
        attempts.set(text, attempt);
        const outcome = answer(text, attempt);
        if (outcome === "refuse") return json(request, 409, { _tag: "ConflictError", message: `refused ${text}` });
        if (outcome === "fail") return json(request, 500, { error: "boom" });
        admitted.push(text);
        const id = "id" in payload && typeof payload.id === "string" ? payload.id : "msg_unknown";
        return json(request, 200, { data: { admittedSeq: admitted.length, id, sessionID, prompt: { text }, delivery: "queue", timeCreated: 1 } });
      }
      return json(request, 404, { error: `no route ${request.method} ${path}` });
    }),
  );
  return { client, admitted, attempts, sessions };
};

/** A device's storage that outlives one outbox (the app being killed and
 * launched again). */
const deviceStorage = () => {
  const stored = new Map<string, string>();
  return Layer.succeed(KeyValueStore.KeyValueStore)(
    KeyValueStore.makeStringOnly({
      get: (key) => Effect.sync(() => stored.get(key)),
      set: (key, value) => Effect.sync(() => void stored.set(key, value)),
      remove: (key) => Effect.sync(() => void stored.delete(key)),
      clear: Effect.sync(() => stored.clear()),
      size: Effect.sync(() => stored.size),
    }),
  );
};

const run = <A, E>(fake: ReturnType<typeof fakeServer>, program: Effect.Effect<A, E, Outbox>, storage = KeyValueStore.layerMemory) =>
  Effect.runPromise(
    program.pipe(
      Effect.provide(
        Outbox.layer.pipe(
          Layer.provideMerge(Reachability.layer),
          Layer.provideMerge(Opencode.layer),
          Layer.provide(Layer.mergeAll(Layer.succeed(HttpClient.HttpClient)(fake.client), storage, DeviceSignals.layerNone, Folders.layerNone)),
        ),
      ),
      Effect.scoped,
    ),
  );

const send = (outbox: Outbox["Service"], sessionID: SessionID, text: string, create: boolean) =>
  outbox.send({ server, sessionID, protocol: "v2", directory, create: create ? {} : undefined, text, files: [], agent: Agent.ID.make("build") });

/** Waits until the outbox has nothing it can send (every lane empty or held). */
const settled = (outbox: Outbox["Service"]) => outbox.drain.pipe(Effect.timeout("10 seconds"));

describe("Outbox", () => {
  it("makes the session, then sends a lane's messages in order", async () => {
    const fake = fakeServer(() => "admit");
    await run(
      fake,
      Effect.gen(function* () {
        const outbox = yield* Outbox;
        const sessionID = SessionID.create();
        yield* send(outbox, sessionID, "one", true);
        yield* send(outbox, sessionID, "two", false);
        yield* send(outbox, sessionID, "three", false);
        yield* settled(outbox);
      }),
    );
    expect(fake.admitted).toEqual(["one", "two", "three"]);
  });

  it("holds a lane at a refused message: nothing overtakes it until it is removed", async () => {
    const fake = fakeServer((text) => (text === "bad" ? "refuse" : "admit"));
    const lanes = await run(
      fake,
      Effect.gen(function* () {
        const outbox = yield* Outbox;
        const sessionID = SessionID.create();
        yield* send(outbox, sessionID, "first", true);
        const bad = yield* send(outbox, sessionID, "bad", false);
        yield* send(outbox, sessionID, "after", false);
        yield* settled(outbox);
        const held = yield* outbox.changes.pipe(Stream.take(1), Stream.runCollect);
        expect(fake.admitted).toEqual(["first"]);
        yield* outbox.remove(server, sessionID, bad.id);
        yield* settled(outbox);
        return held;
      }),
    );
    expect(Array.from(lanes[0] ?? [])[0]?.[1].held?.reason).toContain("refused bad");
    expect(fake.admitted).toEqual(["first", "after"]);
  });

  it("retries a failure that may clear, in place, keeping the order", async () => {
    const fake = fakeServer((text, attempt) => (text === "flaky" && attempt < 3 ? "fail" : "admit"));
    await run(
      fake,
      Effect.gen(function* () {
        const outbox = yield* Outbox;
        const sessionID = SessionID.create();
        yield* send(outbox, sessionID, "flaky", true);
        yield* send(outbox, sessionID, "next", false);
        yield* settled(outbox);
      }),
    );
    expect(fake.attempts.get("flaky")).toBe(3);
    expect(fake.admitted).toEqual(["flaky", "next"]);
  }, 15_000);

  it("keeps lanes independent: a held lane does not stop another", async () => {
    const fake = fakeServer((text) => (text === "stuck" ? "refuse" : "admit"));
    await run(
      fake,
      Effect.gen(function* () {
        const outbox = yield* Outbox;
        yield* send(outbox, SessionID.create(), "stuck", true);
        yield* send(outbox, SessionID.create(), "free", true);
        yield* settled(outbox);
      }),
    );
    expect(fake.admitted).toEqual(["free"]);
  });

  it("resumes what was queued when the app last ran", async () => {
    const storage = deviceStorage();
    // The server is down: the message waits, and the app is killed.
    const down = fakeServer(() => "fail");
    await run(
      down,
      Effect.gen(function* () {
        const outbox = yield* Outbox;
        yield* send(outbox, SessionID.create(), "kept", true);
        // Long enough for the outbox to save it.
        yield* Effect.sleep("400 millis");
      }),
      storage,
    );
    expect(down.admitted).toEqual([]);
    // Launched again, the same server back (its sessions kept): it goes.
    const up = fakeServer(() => "admit", down.sessions);
    await run(
      up,
      Effect.gen(function* () {
        const outbox = yield* Outbox;
        yield* settled(outbox);
      }),
      storage,
    );
    expect(up.admitted).toEqual(["kept"]);
  }, 15_000);
});
