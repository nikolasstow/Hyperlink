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

  it("shows nothing for a turn that ended well or was stopped", () => {
    expect(chatMessagesOfV2([idle("succeeded"), idle("interrupted")])).toEqual([]);
  });
});
