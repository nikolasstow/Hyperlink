import { describe, expect, it } from "vitest";
import { mentionOf, sessionFiles } from "./sessionFiles";
import type { PartsSource } from "./sessionFiles";

const toolPart = (id: string, tool: string, input: Record<string, unknown>) => ({
  id,
  type: "tool",
  tool,
  state: { status: "completed", input, output: "", title: "", metadata: {}, time: { start: 0, end: 0 } },
});

const message = (id: string, parts: ReadonlyArray<ReturnType<typeof toolPart>>) => ({
  id,
  parts: new Map(parts.map((p) => [p.id, p])),
});

const transcript = (messages: ReadonlyArray<ReturnType<typeof message>>): PartsSource => ({
  messages: new Map(messages.map((m) => [m.id, m])),
  order: messages.map((m) => m.id),
});

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

  it("mentions a file relative to the session's folder", () => {
    expect(mentionOf({ path: "/r/src/a.ts", name: "a.ts", edited: false }, "/r")).toBe("@src/a.ts");
    expect(mentionOf({ path: "/elsewhere/x.ts", name: "x.ts", edited: false }, "/r")).toBe("@/elsewhere/x.ts");
  });
});
