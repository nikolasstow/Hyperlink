import { Effect, HashMap, Layer, Option, Stream } from "effect";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";
import { KeyValueStore } from "effect/unstable/persistence";
import { describe, expect, it } from "vitest";
import type { ChatMessage } from "../chat/model";
import { DeviceSignals } from "../effect/DeviceSignals";
import { Opencode } from "../opencode/Opencode";
import { serverAddressOf } from "../opencode/serverAddress";
import { Conversations } from "./Conversations";
import { conversationKey } from "./model";

const server = serverAddressOf("localhost:4096");

/** A fake opencode with v1 sessions (v2 knows none): counts history fetches. */
const fakeServer = (history: ReadonlyArray<{ readonly id: string; readonly text: string }>) => {
  const fetched: Array<string> = [];
  const json = (request: Parameters<typeof HttpClientResponse.fromWeb>[0], body: unknown) =>
    HttpClientResponse.fromWeb(request, new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }));
  const client = HttpClient.make((request, url) =>
    Effect.sync(() => {
      const v2 = /^\/api\/session\/([^/]+)\/message$/.exec(url.pathname);
      if (v2 !== null) return json(request, { data: [], cursor: {} });
      const v1 = /^\/session\/([^/]+)\/message$/.exec(url.pathname);
      if (v1 !== null) {
        if (url.searchParams.get("limit") !== "1") fetched.push(v1[1] ?? "");
        return json(
          request,
          history.map((message) => ({
            info: { id: message.id, role: "user", time: { created: 1_700_000_000_000 } },
            parts: [{ id: `${message.id}:p`, messageID: message.id, sessionID: v1[1], type: "text", text: message.text }],
          })),
        );
      }
      return json(request, {});
    }),
  );
  return { client, fetched };
};

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

const run = <A, E>(fake: ReturnType<typeof fakeServer>, program: Effect.Effect<A, E, Conversations>, storage = deviceStorage()) =>
  Effect.runPromise(
    program.pipe(
      Effect.provide(Conversations.layer.pipe(Layer.provideMerge(Opencode.layer), Layer.provide(Layer.mergeAll(Layer.succeed(HttpClient.HttpClient)(fake.client), storage, DeviceSignals.layerNone)))),
      Effect.scoped,
    ),
  );

/** Waits until the session is kept with at least `updated`, and returns it. */
const keptWhen = (conversations: Conversations["Service"], id: string, updated: number) =>
  conversations.changes.pipe(
    Stream.map((kept) => HashMap.get(kept, conversationKey(server, id))),
    Stream.filter((found) => Option.isSome(found) && found.value.updated >= updated),
    Stream.take(1),
    Stream.runHead,
    Effect.map(Option.flatten),
    Effect.timeout("5 seconds"),
  );

describe("Conversations", () => {
  it("keeps a session's newest messages and its protocol", async () => {
    const fake = fakeServer([{ id: "msg_a", text: "hello" }]);
    const kept = await run(
      fake,
      Effect.gen(function* () {
        const conversations = yield* Conversations;
        yield* conversations.preload(server, [{ id: "ses_1", updated: 10 }]);
        return yield* keptWhen(conversations, "ses_1", 10);
      }),
    );
    const conversation = Option.getOrThrow(kept);
    expect(conversation.protocol).toBe("v1");
    expect(conversation.messages.map((message) => message.parts.map((part) => (part.kind === "text" ? part.text : "")))).toEqual([["hello"]]);
  });

  it("fetches a session once, and again only when the server changed it", async () => {
    const fake = fakeServer([{ id: "msg_a", text: "hello" }]);
    await run(
      fake,
      Effect.gen(function* () {
        const conversations = yield* Conversations;
        // Asked for twice at once (two buttons): fetched once.
        yield* conversations.preload(server, [{ id: "ses_1", updated: 10 }]);
        yield* conversations.preload(server, [{ id: "ses_1", updated: 10 }]);
        yield* keptWhen(conversations, "ses_1", 10);
        // Unchanged: not fetched.
        yield* conversations.preload(server, [{ id: "ses_1", updated: 10 }]);
        yield* Effect.sleep("50 millis");
        // Changed on the server: fetched.
        yield* conversations.preload(server, [{ id: "ses_1", updated: 20 }]);
        yield* keptWhen(conversations, "ses_1", 20);
      }),
    );
    expect(fake.fetched).toEqual(["ses_1", "ses_1"]);
  });

  it("keeps a session's title, and a newer one without fetching its messages again", async () => {
    const fake = fakeServer([{ id: "msg_a", text: "hello" }]);
    const kept = await run(
      fake,
      Effect.gen(function* () {
        const conversations = yield* Conversations;
        yield* conversations.preload(server, [{ id: "ses_1", updated: 10, title: "First" }]);
        yield* keptWhen(conversations, "ses_1", 10);
        yield* conversations.preload(server, [{ id: "ses_1", updated: 10, title: "Second" }]);
        yield* Effect.sleep("50 millis");
        yield* conversations.retitle(server, "ses_1", "Renamed");
        return yield* keptWhen(conversations, "ses_1", 10);
      }),
    );
    expect(Option.getOrThrow(kept).title).toBe("Renamed");
    expect(fake.fetched).toEqual(["ses_1"]);
  });

  it("keeps an open chat's messages once they stop changing", async () => {
    const fake = fakeServer([]);
    const kept = await run(
      fake,
      Effect.gen(function* () {
        const conversations = yield* Conversations;
        const message = (text: string): ChatMessage => ({ id: "msg_a", role: "user", parts: [{ kind: "text", id: "p", text }] });
        yield* conversations.remember(server, "ses_1", "v2", [message("first")]);
        yield* conversations.remember(server, "ses_1", "v2", [message("second")]);
        return yield* keptWhen(conversations, "ses_1", 0);
      }),
    );
    const conversation = Option.getOrThrow(kept);
    expect(conversation.messages.map((message) => message.parts.map((part) => (part.kind === "text" ? part.text : "")))).toEqual([["second"]]);
  });

  it("reads back what the device kept when the app opens again", async () => {
    const storage = deviceStorage();
    const fake = fakeServer([{ id: "msg_a", text: "hello" }]);
    await run(
      fake,
      Effect.gen(function* () {
        const conversations = yield* Conversations;
        yield* conversations.preload(server, [{ id: "ses_1", updated: 10 }]);
        yield* keptWhen(conversations, "ses_1", 10);
        // Long enough for it to be written.
        yield* Effect.sleep("700 millis");
      }),
      storage,
    );
    const offline = fakeServer([]);
    const kept = await run(
      offline,
      Effect.gen(function* () {
        const conversations = yield* Conversations;
        return yield* keptWhen(conversations, "ses_1", 10);
      }),
      storage,
    );
    expect(Option.isSome(kept)).toBe(true);
    expect(offline.fetched).toEqual([]);
  });
});
