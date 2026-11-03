import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { SessionEvent } from "../opencode/schema/session-event";
import { applyDurable, type Projection } from "./messageProjection";

const decode = Schema.decodeUnknownSync(SessionEvent.Durable);
let seq = 0;
const event = (type: string, data: Record<string, unknown>, created: number) => {
  seq += 1;
  return decode({ id: `evt_${String(seq).padStart(4, "0")}`, type, created, durable: { aggregateID: "ses_a", seq, version: 1 }, data: { sessionID: "ses_a", ...data } });
};

describe("messageProjection", () => {
  it("adds your message when its inbox item is delivered", async () => {
    const projection: Projection = { messages: [], inbox: new Map() };
    const run = (...events: ReadonlyArray<ReturnType<typeof event>>) => Effect.runPromise(Effect.forEach(events, (each) => applyDurable(projection, each), { discard: true }));
    await run(
      event("session.inbox.enqueued", { inboxID: "msg_0001", item: { type: "user", delivery: "queue", payload: { text: "hello" } } }, 1_000),
      event("session.inbox.delivered", { inboxID: "msg_0001" }, 2_000),
    );
    expect(projection.messages.map((message) => [message.id, message.type])).toEqual([["msg_0001", "user"]]);
    expect(projection.inbox.size).toBe(0);
  });

  it("drops a cancelled item, and a delivery it never saw adds nothing", async () => {
    const projection: Projection = { messages: [], inbox: new Map() };
    await Effect.runPromise(
      Effect.forEach(
        [
          event("session.inbox.enqueued", { inboxID: "msg_0002", item: { type: "user", delivery: "queue", payload: { text: "x" } } }, 1_000),
          event("session.inbox.cancelled", { inboxID: "msg_0002" }, 1_500),
          event("session.inbox.delivered", { inboxID: "msg_0003" }, 2_000),
        ],
        (each) => applyDurable(projection, each),
        { discard: true },
      ),
    );
    expect(projection.messages).toEqual([]);
  });
});

describe("messageProjection replay", () => {
  const step = (created: number) =>
    event("session.step.started", { assistantMessageID: "msg_a1", agent: "console", model: { id: "m", providerID: "p" }, started: created }, created);
  const run = (projection: Projection, ...events: ReadonlyArray<ReturnType<typeof event>>) =>
    Effect.runPromise(Effect.forEach(events, (each) => applyDurable(projection, each), { discard: true }));
  const content = (projection: Projection) => {
    const assistant = projection.messages.find((message) => message.type === "assistant");
    return assistant?.type === "assistant" ? assistant.content.map((item) => (item.type === "tool" ? `tool:${item.id}` : item.type)) : [];
  };

  it("adds a tool once when its start event comes twice", async () => {
    const projection: Projection = { messages: [], inbox: new Map() };
    const started = event("session.tool.input.started", { assistantMessageID: "msg_a1", id: "toolu_1", name: "read" }, 1_100);
    await run(projection, step(1_000), started, started);
    expect(content(projection)).toEqual(["tool:toolu_1"]);
  });

  it("adds a text block once when its start event comes twice, by ordinal", async () => {
    const projection: Projection = { messages: [], inbox: new Map() };
    const first = event("session.text.started", { assistantMessageID: "msg_a1", ordinal: 0 }, 1_100);
    const second = event("session.text.started", { assistantMessageID: "msg_a1", ordinal: 1 }, 1_300);
    await run(projection, step(1_000), first, first, second, second);
    expect(content(projection)).toEqual(["text", "text"]);
  });

  it("adds a reasoning block once when its start event comes twice", async () => {
    const projection: Projection = { messages: [], inbox: new Map() };
    const started = event("session.reasoning.started", { assistantMessageID: "msg_a1", ordinal: 0 }, 1_100);
    await run(projection, step(1_000), started, started);
    expect(content(projection)).toEqual(["reasoning"]);
  });

  it("still lets a second tool with another id through", async () => {
    const projection: Projection = { messages: [], inbox: new Map() };
    await run(
      projection,
      step(1_000),
      event("session.tool.input.started", { assistantMessageID: "msg_a1", id: "toolu_1", name: "read" }, 1_100),
      event("session.tool.input.started", { assistantMessageID: "msg_a1", id: "toolu_2", name: "grep" }, 1_200),
    );
    expect(content(projection)).toEqual(["tool:toolu_1", "tool:toolu_2"]);
  });
});
