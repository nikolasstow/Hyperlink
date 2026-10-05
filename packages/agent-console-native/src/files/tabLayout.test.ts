import { describe, expect, it } from "vitest";
import type { FileNavEntry, FilePlace } from "./FileNav";
import { parentOf, tabLayout } from "./tabLayout";

const file = (path: string): FileNavEntry => ({ path, name: path.split("/").pop() ?? path, kind: "file" });
const dir = (path: string): FileNavEntry => ({ path, name: path.split("/").pop() ?? path, kind: "directory" });
const placeOf = (entries: ReadonlyArray<FileNavEntry>): FilePlace => ({
  root: "/r",
  tabs: entries.map((entry, index) => ({ id: `t${index}`, entries: [entry], index: 0 })),
  active: 0,
  history: [],
});
const screen = { width: 400 };

describe("parentOf", () => {
  it("is the folder a path is in", () => {
    expect(parentOf("/r/src/a.ts")).toBe("/r/src");
    expect(parentOf("/r/src/")).toBe("/r");
    expect(parentOf("/r")).toBe("/");
  });
});

describe("tabLayout", () => {
  it("groups a folder's tabs under its path, in the order of their first tab, and keeps the rest together", () => {
    const layout = tabLayout(placeOf([file("/r/README.md"), file("/r/src/a.ts"), dir("/r/docs"), file("/r/src/b.ts")]), "all", screen, 0);
    // README.md and docs are both in /r: a group; a.ts and b.ts in /r/src: another.
    expect(layout.headers.map((header) => header.folder)).toEqual(["/r", "/r/src"]);
    expect(layout.tabs.map((tab) => [tab.index, tab.grouped])).toEqual([
      [0, true],
      [2, true],
      [1, true],
      [3, true],
    ]);
  });

  it("leaves a lone tab ungrouped, beside the others, its folder under its name", () => {
    const layout = tabLayout(placeOf([file("/r/a/x.ts"), file("/r/b/y.ts"), file("/r/b/z.ts")]), "all", screen, 0);
    expect(layout.headers.map((header) => header.folder)).toEqual(["/r/b"]);
    const lone = layout.tabs.find((tab) => tab.index === 0);
    expect(lone?.grouped).toBe(false);
    // Its block first (its tab first); the group's header below it.
    expect(layout.headers[0]?.y).toBeGreaterThan(lone?.y ?? Infinity);
  });

  it("puts two tabs side by side and a third on the next row", () => {
    const layout = tabLayout(placeOf([file("/r/a.ts"), file("/r/b.ts"), file("/r/c.ts")]), "all", screen, 0);
    const [first, second, third] = layout.tabs;
    expect(first?.y).toBe(second?.y);
    expect(second?.x).toBeGreaterThan(first?.x ?? 0);
    expect(third?.x).toBe(first?.x);
    expect(third?.y).toBeGreaterThan(first?.y ?? 0);
  });

  it("lays out a tab about to be added where it will be", () => {
    const place = placeOf([file("/r/a.ts")]);
    const layout = tabLayout(place, "all", screen, 0, file("/r/b.ts"));
    expect(layout.tabs.map((tab) => tab.index)).toEqual([0, 1]);
  });

  it("shows only files or folders when filtered", () => {
    const place = placeOf([file("/r/a.ts"), dir("/r/src")]);
    expect(tabLayout(place, "files", screen, 0).tabs.map((tab) => tab.index)).toEqual([0]);
    expect(tabLayout(place, "folders", screen, 0).tabs.map((tab) => tab.index)).toEqual([1]);
  });
});
