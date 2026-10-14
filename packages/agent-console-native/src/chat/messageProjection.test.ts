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
