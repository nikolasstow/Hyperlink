import type { TextPart } from "@opencode-ai/sdk";
import { describe, expect, it } from "vitest";
import { busyFromHistory, type Transcript, withPart, withRole } from "./useSessionStream";

const empty: Transcript = { messages: new Map(), order: [], busy: false };

const text = (messageID: string, id: string): TextPart => ({ id, sessionID: "ses", messageID, type: "text", text: "hi" });

describe("transcript", () => {
  it("keeps a message's time as its parts arrive", () => {
    let transcript = withRole(empty, "msg_a", "user", undefined, { created: 5 });
    transcript = withPart(transcript, text("msg_a", "prt_a"));
    expect(transcript.messages.get("msg_a")?.time).toEqual({ created: 5 });
  });

  it("reads busy from history: the newest answer still being written", () => {
    let transcript = withRole(empty, "msg_b", "assistant", { providerID: "p", modelID: "m" }, { created: 5 });
    transcript = withPart(transcript, text("msg_b", "prt_b"));
    expect(busyFromHistory(transcript)).toBe(true);
  });
});
