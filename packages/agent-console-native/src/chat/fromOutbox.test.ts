import { describe, expect, it } from "vitest";
import { Agent } from "../opencode/schema/agent";
import { SessionMessage } from "../opencode/schema/session-message";
import { CommandRun, QueuedMessage, SkillRun } from "../outbox/model";
import { chatMessageOfQueued, pendingMessages } from "./fromOutbox";
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

  it("lets a command go once the server took it (its message comes back as the command's prompt)", () => {
    const command: ChatMessage = { ...queued("c"), slash: { name: "review", source: "command" } };
    expect(pendingMessages([command], [], new Set())).toEqual([]);
  });

  it("shows a queued /skill or /command as its name and the text after it", () => {
    const base = { files: [], agent: Agent.ID.make("build"), queuedAt: 1 };
    const skill = chatMessageOfQueued(QueuedMessage.make({ ...base, id: SessionMessage.ID.make("msg_s"), text: "/unslop this", run: SkillRun.make({ id: "unslop", end: 7 }) }));
    const command = chatMessageOfQueued(QueuedMessage.make({ ...base, id: SessionMessage.ID.make("msg_c"), text: "/review last", run: CommandRun.make({ name: "review", args: "last" }) }));
    expect([skill.slash, skill.parts[0]]).toEqual([{ name: "unslop", source: "skill" }, { kind: "text", id: "msg_s:text", text: "this" }]);
    expect([command.slash, command.parts[0]]).toEqual([{ name: "review", source: "command" }, { kind: "text", id: "msg_c:text", text: "last" }]);
  });

  it("drops what the conversation already shows", () => {
    expect(pendingMessages([], [queued("a")], new Set(["a"]))).toEqual([]);
  });
});
