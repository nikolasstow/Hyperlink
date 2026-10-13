import { describe, expect, it } from "vitest";
import { pathCrumbs, scopesAt } from "./breadcrumbs";
import { stickyRanges } from "./stickyRanges";

const code = [
  "export class Store {", // 0
  "  get(key: string) {", // 1
  "    if (key) {", // 2
  "      return 1;", // 3
  "    }", // 4
  "  }", // 5
  "}", // 6
  "", // 7
  "export const f = () => {", // 8
  "  return 2;", // 9
  "};", // 10
].join("\n");

describe("breadcrumbs", () => {
  it("names the scopes a line is in, outermost first, skipping unnamed ones", async () => {
    const ranges = await stickyRanges(code, "typescript");
    const inner = scopesAt(ranges, 3);
    expect(inner.length).toBe(2);
    expect(inner[0]).toContain("Store");
    expect(inner[1]).toContain("get");
  });

  it("counts a scope's own header line as inside it", async () => {
    const ranges = await stickyRanges(code, "typescript");
    expect(scopesAt(ranges, 1).at(-1)).toContain("get");
  });

  it("has no scopes between them", async () => {
    const ranges = await stickyRanges(code, "typescript");
    expect(scopesAt(ranges, 7)).toEqual([]);
  });

  it("reads the path from the worktree's root", () => {
    expect(pathCrumbs("/repo/src/files/a.ts", "/repo")).toEqual(["src", "files", "a.ts"]);
    expect(pathCrumbs("/repo/src/a.ts", "/repo/")).toEqual(["src", "a.ts"]);
  });

  it("keeps the whole path outside the root", () => {
    expect(pathCrumbs("/other/a.ts", "/repo")).toEqual(["other", "a.ts"]);
    expect(pathCrumbs("/other/a.ts", undefined)).toEqual(["other", "a.ts"]);
  });
});
