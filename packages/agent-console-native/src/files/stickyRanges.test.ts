import { describe, expect, it } from "vitest";
import { pinnable, stickyRanges } from "./stickyRanges";

describe("stickyRanges — TypeScript", () => {
  it("nests a method inside a class, header on the declaration line", async () => {
    const code = ["class A {", "  run() {", "    const x = 1;", "    return x;", "  }", "}", ""].join("\n");
    const ranges = await stickyRanges(code, "typescript");
    const cls = ranges.find((r) => r.header === 0);
    const method = ranges.find((r) => r.header === 1);
    expect(cls).toMatchObject({ start: 0, end: 5, depth: 0, symbol: { kind: "class", name: "A" } });
    expect(method).toMatchObject({ start: 1, end: 4, depth: 1, symbol: { kind: "method", name: "run" } });
  });

  it("names a named arrow from its variable, and leaves bare blocks unnamed", async () => {
    const code = ["const go = () => {", "  if (x) {", "    y();", "  }", "};"].join("\n");
    const ranges = await stickyRanges(code, "typescript");
    expect(ranges.find((r) => r.header === 0)?.symbol).toEqual({ kind: "function", name: "go" });
    expect(ranges.find((r) => r.header === 1)?.symbol).toBeUndefined();
    // The arrow owns the sticky; the variable statement doesn't double up.
    expect(ranges.filter((r) => r.header === 0)).toHaveLength(1);
  });

  it("makes a const with a multi-line type/value its own sticky scope", async () => {
    const code = ["export const validate: {", "  (a: number): void", "  (a: string): void", "} = internal.validate;"].join("\n");
    const ranges = await stickyRanges(code, "typescript");
    expect(ranges.find((r) => r.header === 0)).toMatchObject({ start: 0, end: 3, depth: 0, symbol: { kind: "constant", name: "validate" } });
  });

  it("captures a type alias", async () => {
    const code = ["type Big = {", "  a: number", "  b: string", "};"].join("\n");
    const ranges = await stickyRanges(code, "typescript");
    expect(ranges.find((r) => r.header === 0)).toMatchObject({ symbol: { kind: "type", name: "Big" }, depth: 0 });
  });

  it("captures a multi-line if block", async () => {
    const code = ["function f() {", "  if (cond) {", "    work();", "  }", "}"].join("\n");
    const ranges = await stickyRanges(code, "typescript");
    expect(ranges.some((r) => r.header === 1 && r.end === 3 && r.depth === 1)).toBe(true);
  });

  it("names one-line declarations, but leaves them out of what sticky scroll pins", async () => {
    const code = ["export function isFull(): boolean { return count >= limit; }", "if (x) { y(); }"].join("\n");
    const ranges = await stickyRanges(code, "typescript");
    expect(ranges.map((range) => range.symbol)).toEqual([{ kind: "function", name: "isFull" }]);
    expect(pinnable(ranges)).toEqual([]);
  });

  it("parses tsx", async () => {
    const code = ["const C = () => {", "  return <div>{x}</div>;", "};"].join("\n");
    const ranges = await stickyRanges(code, "tsx");
    expect(ranges.some((r) => r.header === 0 && r.end === 2)).toBe(true);
  });
});

describe("stickyRanges — markdown", () => {
  it("nests headings by level, each running to the next same-or-higher heading", async () => {
    const md = ["# Top", "intro", "## A", "a body", "## B", "b body", "more"].join("\n");
    const ranges = await stickyRanges(md, "markdown");
    expect(ranges.find((r) => r.header === 0)).toMatchObject({ start: 0, end: 6, depth: 0 });
    expect(ranges.find((r) => r.header === 2)).toMatchObject({ start: 2, end: 3, depth: 1 });
    expect(ranges.find((r) => r.header === 4)).toMatchObject({ start: 4, end: 6, depth: 1 });
  });

  it("ignores headings inside fenced code", async () => {
    const md = ["# Real", "```", "# not a heading", "```", "text"].join("\n");
    const ranges = await stickyRanges(md, "markdown");
    expect(ranges.filter((r) => r.header !== 0)).toEqual([]);
  });
});

describe("stickyRanges — extension aliases (what langFromFilename emits)", () => {
  it("treats `ts` like typescript", async () => {
    const code = ["function f() {", "  return 1;", "}"].join("\n");
    expect((await stickyRanges(code, "ts")).some((r) => r.header === 0)).toBe(true);
  });
  it("treats `md` like markdown", async () => {
    const md = ["# A", "body", "text"].join("\n");
    expect((await stickyRanges(md, "md")).some((r) => r.header === 0)).toBe(true);
  });
});

describe("stickyRanges — unsupported", () => {
  it("returns nothing for a language without an on-device parser", async () => {
    expect(await stickyRanges("package main\nfunc main() {}\n", "go")).toEqual([]);
  });
});
