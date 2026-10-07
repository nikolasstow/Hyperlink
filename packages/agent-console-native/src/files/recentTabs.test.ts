import { describe, expect, it } from "vitest";
import type { FileNavEntry, FilePlace } from "./FileNav";
import { recentTabsOf } from "./recentTabs";

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
