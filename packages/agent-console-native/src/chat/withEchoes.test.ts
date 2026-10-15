import { describe, expect, it } from "vitest";
import type { ChatMessage } from "./model";
import { withEchoes } from "./withEchoes";

const user = (id: string, text: string): ChatMessage => ({ id, role: "user", parts: [{ kind: "text", id: `${id}:text`, text }] });

describe("withEchoes", () => {
  it("shows a command's message as typed: its chip and arguments, not its prompt", () => {
    const messages = [user("a", "hello"), user("b", "You are reviewing changes… the last commit")];
    const [kept, shown] = withEchoes(messages, { b: { name: "review", args: "the last commit" } });
    expect(kept).toBe(messages[0]);
    expect(shown?.slash).toEqual({ name: "review", source: "command" });
    expect(shown?.parts).toEqual([{ kind: "text", id: "b:text", text: "the last commit" }]);
    // The same view each time, so its bubble is not redrawn.
    expect(withEchoes(messages, { b: { name: "review", args: "the last commit" } })[1]).toBe(shown);
  });

  it("is the same list when no message is a command's", () => {
    const messages = [user("a", "hello")];
    expect(withEchoes(messages, {})).toBe(messages);
  });
});
