import { describe, expect, it } from "vitest";
import type { SessionSummary } from "../sessions/sessionList";
import { sessionsForFile } from "./sessionsForFile";

const session = (id: string, directory: string, updated: number): SessionSummary => ({
  id,
  title: id,
  directory,
  time: { created: 0, updated },
});

describe("sessionsForFile", () => {
  const sessions = [
    session("a", "/app/main", 30),
    session("b", "/app/main", 10),
    session("c", "/app/worktrees/feature", 40),
    session("d", "/other", 50),
  ];

  it("counts the sessions whose worktree contains the file, newest first", () => {
    const { related } = sessionsForFile(sessions, "/app/main/src/x.ts");
    expect(related.map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("orders the full list related-first, then the rest, each by recency", () => {
    const { all } = sessionsForFile(sessions, "/app/main/src/x.ts");
    expect(all.map((s) => s.id)).toEqual(["a", "b", "d", "c"]);
  });

  it("has no related sessions when none of their worktrees hold the file", () => {
    expect(sessionsForFile(sessions, "/elsewhere/x.ts").related).toEqual([]);
  });
});
