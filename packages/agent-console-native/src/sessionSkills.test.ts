import { describe, expect, it } from "vitest";
import type { ChatMessage } from "./chat/model";
import { sessionSkills } from "./sessionSkills";

const user = (id: string, extra: Partial<ChatMessage>): ChatMessage => ({ id, role: "user", parts: [], ...extra });
const loaded = (id: string, skill: string): ChatMessage => ({
  id,
  role: "assistant",
  parts: [{ kind: "tool", id: `${id}:tool`, name: "skill", status: "completed", input: { id: skill } }],
});

describe("sessionSkills", () => {
  it("lists the skills you sent and the ones the agent loaded, newest first, each once", () => {
    const messages = [
      user("a", { slash: { name: "unslop", source: "skill" } }),
      loaded("b", "pdf"),
      user("c", { slash: { name: "review", source: "command" }, skills: ["docs"] }),
      user("d", { slash: { name: "unslop", source: "skill" } }),
    ];
    expect(sessionSkills(messages)).toEqual(["unslop", "docs", "pdf"]);
  });

  it("leaves out commands and other tools", () => {
    const other: ChatMessage = { id: "e", role: "assistant", parts: [{ kind: "tool", id: "e:tool", name: "read", status: "completed", input: { id: "x" } }] };
    expect(sessionSkills([user("f", { slash: { name: "review", source: "command" } }), other])).toEqual([]);
  });
});
