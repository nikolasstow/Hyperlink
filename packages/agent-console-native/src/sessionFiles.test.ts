import { describe, expect, it } from "vitest";
import type { ChatMessage, ChatTool } from "./chat/model";
import { sessionFiles } from "./sessionFiles";

const toolPart = (id: string, name: string, input: Record<string, unknown>): ChatTool => ({
  kind: "tool",
  id,
  name,
  status: "completed",
  input,
  output: "",
});

const message = (id: string, parts: ReadonlyArray<ChatTool>): ChatMessage => ({
  id,
  role: "assistant",
  parts,
});

const transcript = (messages: ReadonlyArray<ChatMessage>): ReadonlyArray<ChatMessage> => messages;

describe("sessionFiles", () => {
  const t = transcript([
    message("m1", [toolPart("p1", "read", { filePath: "/r/src/a.ts" }), toolPart("p2", "glob", { path: "/r/src" })]),
    message("m2", [toolPart("p3", "edit", { filePath: "/r/src/a.ts" }), toolPart("p4", "read", { filePath: "src/b.ts" })]),
  ]);

  it("lists touched files newest first, once each, folders left out", () => {
    expect(sessionFiles(t, "/r").map((f) => f.path)).toEqual(["/r/src/b.ts", "/r/src/a.ts"]);
  });

  it("marks a file edited if any tool changed it", () => {
    expect(sessionFiles(t, "/r").find((f) => f.path === "/r/src/a.ts")?.edited).toBe(true);
    expect(sessionFiles(t, "/r").find((f) => f.path === "/r/src/b.ts")?.edited).toBe(false);
  });

});
