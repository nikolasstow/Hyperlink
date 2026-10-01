import { describe, expect, it } from "vitest";
import type { ChatMessage } from "./model";
import { latestReceipt, readTimeLabel } from "./receipt";

const user = (id: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({ id, role: "user", parts: [], time: { created: 1_000_000_000_000 }, ...extra });
const assistant = (id: string, created: number): ChatMessage => ({ id, role: "assistant", parts: [], time: { created } });

describe("latestReceipt", () => {
  it("is nothing before you have written", () => {
    expect(latestReceipt([assistant("a", 1)], undefined)).toBeUndefined();
  });

  it("is Sending while queued, Not Delivered when its lane is held on it", () => {
    expect(latestReceipt([user("m", { queued: true })], undefined)).toEqual({ messageID: "m", receipt: { kind: "sending" } });
    expect(latestReceipt([user("m", { queued: true })], "m")).toEqual({ messageID: "m", receipt: { kind: "notDelivered" } });
  });

  it("is Delivered on the server, Read at the answer's start", () => {
    expect(latestReceipt([user("m")], undefined)?.receipt).toEqual({ kind: "delivered" });
    expect(latestReceipt([user("m"), assistant("a", 1_700_000_000_000)], undefined)?.receipt).toEqual({ kind: "read", at: 1_700_000_000_000 });
  });

  it("is for your latest message only, read by an answer after it", () => {
    const messages = [user("old"), assistant("a", 1_700_000_000_000), user("new")];
    expect(latestReceipt(messages, undefined)).toEqual({ messageID: "new", receipt: { kind: "delivered" } });
  });

  it("takes seconds as seconds", () => {
    expect(latestReceipt([user("m"), assistant("a", 1_700_000_000)], undefined)?.receipt).toEqual({ kind: "read", at: 1_700_000_000_000 });
  });
});

describe("readTimeLabel", () => {
  const now = new Date(2026, 9, 1, 15, 0).getTime();

  it("is the time today", () => {
    expect(readTimeLabel(new Date(2026, 9, 1, 9, 5).getTime(), now)).toBe(new Date(2026, 9, 1, 9, 5).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }));
  });

  it("is Yesterday, then the weekday, then the date", () => {
    expect(readTimeLabel(new Date(2026, 8, 30, 23, 0).getTime(), now)).toBe("Yesterday");
    expect(readTimeLabel(new Date(2026, 8, 27, 12, 0).getTime(), now)).toBe(new Date(2026, 8, 27).toLocaleDateString([], { weekday: "long" }));
    expect(readTimeLabel(new Date(2026, 8, 20, 12, 0).getTime(), now)).toBe(new Date(2026, 8, 20).toLocaleDateString([], { month: "numeric", day: "numeric", year: "2-digit" }));
  });
});
