import { describe, expect, it } from "vitest";
import { pendingMessages } from "./fromOutbox";
import type { ChatMessage } from "./model";

const queued = (id: string): ChatMessage => ({ id, role: "user", parts: [], time: { created: 1 }, queued: true });

describe("pendingMessages", () => {
  it("shows what is queued", () => {
    const a = queued("a");
    expect(pendingMessages([], [a], new Set())).toEqual([a]);
  });

  it("keeps a message the server took until the conversation has it", () => {
    const a = queued("a");
    const taken = pendingMessages([a], [], new Set());
    expect(taken.map((message) => [message.id, message.queued])).toEqual([["a", false]]);
    // The same object from render to render, so its bubble stays.
    expect(pendingMessages(taken, [], new Set())[0]).toBe(taken[0]);
    expect(pendingMessages(taken, [], new Set(["a"]))).toEqual([]);
  });

  it("drops what the conversation already shows", () => {
    expect(pendingMessages([], [queued("a")], new Set(["a"]))).toEqual([]);
  });
});
