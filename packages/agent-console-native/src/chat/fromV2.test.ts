import { describe, expect, it } from "vitest";
import { Schema } from "effect";
import { SessionMessage } from "../opencode/schema/session-message";
import { chatMessagesOfV2 } from "./fromV2";

const decode = Schema.decodeUnknownSync(SessionMessage.Info);
const idle = (outcome: string, error?: unknown) =>
  decode({ id: "msg_idle", type: "idle", time: { created: 1_700_000_000_000 }, outcome, ...(error === undefined ? {} : { error }) });

describe("chatMessagesOfV2", () => {
  it("shows a failed turn's error as the agent's answer", () => {
    const [message] = chatMessagesOfV2([idle("failed", { type: "provider.no-route", message: "Model unavailable: opencode/x" })]);
    expect(message?.role).toBe("assistant");
    expect(message?.parts).toEqual([{ kind: "error", id: "msg_idle:error", text: "Model unavailable: opencode/x" }]);
  });

  it("shows a message's leading skill as its /name, the text after it", () => {
    const user = decode({
      id: "msg_user",
      type: "user",
      time: { created: 1_700_000_000_000 },
      text: "/unslop this paragraph",
      skills: [{ id: "unslop", name: "Unslop", mention: { start: 0, end: 7, text: "/unslop" } }],
    });
    const [message] = chatMessagesOfV2([user]);
    expect(message?.slash).toEqual({ name: "unslop", source: "skill" });
    expect(message?.parts).toEqual([{ kind: "text", id: "msg_user:text", text: "this paragraph" }]);
  });

  it("shows nothing for a turn that ended well or was stopped", () => {
    expect(chatMessagesOfV2([idle("succeeded"), idle("interrupted")])).toEqual([]);
  });
});
