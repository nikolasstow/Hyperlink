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
  it("names the scopes a line is in, outermost first, skipping unnamed ones, each with its header line", async () => {
    const ranges = await stickyRanges(code, "typescript");
    const inner = scopesAt(ranges, 3);
    expect(inner).toEqual([
      { kind: "class", name: "Store", line: 0 },
      { kind: "method", name: "get", line: 1 },
    ]);
  });

  it("counts a scope's own header line as inside it", async () => {
    const ranges = await stickyRanges(code, "typescript");
    expect(scopesAt(ranges, 1).at(-1)).toEqual({ kind: "method", name: "get", line: 1 });
  });

  it("names a one-line function on its line", async () => {
    const ranges = await stickyRanges("export function isFull(): boolean { return count >= limit; }", "typescript");
    expect(scopesAt(ranges, 0)).toEqual([{ kind: "function", name: "isFull", line: 0 }]);
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
