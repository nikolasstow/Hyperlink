import { describe, expect, it } from "vitest";
import type { FileNavEntry, FilePlace } from "./FileNav";
import { recentSubtitlesOf, recentTabsOf, type RecentTab, type WorktreeRef } from "./recentTabs";

const file = (path: string): FileNavEntry => ({ path, name: path.split("/").pop() ?? path, kind: "file" });
const place = (visits: ReadonlyArray<readonly [string, number]>): FilePlace => ({
  root: "/r",
  tabs: [],
  active: 0,
  history: visits.map(([path, at]) => ({ entry: file(path), at })),
});

describe("recentTabsOf", () => {
  it("takes the newest across every repo, newest first, up to the limit", () => {
    const places: ReadonlyArray<readonly [string, FilePlace]> = [
      ["app", place([["/a/x.ts", 30], ["/a/y.ts", 10]])],
      ["site", place([["/s/z.ts", 20]])],
    ];
    expect(recentTabsOf(places, 2).map((t) => [t.repo, t.entry.path])).toEqual([
      ["app", "/a/x.ts"],
      ["site", "/s/z.ts"],
    ]);
  });

  it("keeps only the newest open of a repeated path", () => {
    const places: ReadonlyArray<readonly [string, FilePlace]> = [["app", place([["/a/x.ts", 10], ["/a/x.ts", 40], ["/a/y.ts", 20]])]];
    expect(recentTabsOf(places, 5).map((t) => [t.entry.path, t.at])).toEqual([
      ["/a/x.ts", 40],
      ["/a/y.ts", 20],
    ]);
  });

  it("is empty with no history", () => {
    expect(recentTabsOf([["app", place([])]], 6)).toEqual([]);
  });
});

describe("recentSubtitlesOf", () => {
  const recent = (repo: string, path: string): RecentTab => ({ repo, entry: file(path), at: 0 });
  const worktrees: ReadonlyMap<string, ReadonlyArray<WorktreeRef>> = new Map([
    ["app", [{ name: "main", path: "/app/main" }, { name: "feature", path: "/app/worktrees/feature" }]],
  ]);

  it("shows the parent folder relative to the worktree", () => {
    expect(recentSubtitlesOf([recent("app", "/app/main/src/files/x.ts")], worktrees)).toEqual(["src/files"]);
  });

  it("falls back to the worktree name at the worktree root", () => {
    expect(recentSubtitlesOf([recent("app", "/app/main/x.ts")], worktrees)).toEqual(["main"]);
  });

  it("uses the worktree name when the same relative path is in two worktrees", () => {
    const tabs = [recent("app", "/app/main/src/x.ts"), recent("app", "/app/worktrees/feature/src/x.ts")];
    expect(recentSubtitlesOf(tabs, worktrees)).toEqual(["main", "feature"]);
  });

  it("keeps the relative parent when two entries differ in it", () => {
    const tabs = [recent("app", "/app/main/src/a/x.ts"), recent("app", "/app/main/src/b/x.ts")];
    expect(recentSubtitlesOf(tabs, worktrees)).toEqual(["src/a", "src/b"]);
  });

  it("uses the whole parent path when outside every worktree", () => {
    expect(recentSubtitlesOf([recent("app", "/elsewhere/deep/x.ts")], worktrees)).toEqual(["/elsewhere/deep"]);
  });
});
