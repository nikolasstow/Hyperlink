import { describe, expect, it } from "vitest";
import { stickyRanges } from "./stickyRanges";

describe("stickyRanges — TypeScript", () => {
  it("nests a method inside a class, header on the declaration line", async () => {
    const code = ["class A {", "  run() {", "    const x = 1;", "    return x;", "  }", "}", ""].join("\n");
    const ranges = await stickyRanges(code, "typescript");
    const cls = ranges.find((r) => r.header === 0);
    const method = ranges.find((r) => r.header === 1);
    expect(cls).toMatchObject({ start: 0, end: 5, depth: 0 });
    expect(method).toMatchObject({ start: 1, end: 4, depth: 1 });
  });

  it("captures a multi-line if block", async () => {
    const code = ["function f() {", "  if (cond) {", "    work();", "  }", "}"].join("\n");
    const ranges = await stickyRanges(code, "typescript");
    expect(ranges.some((r) => r.header === 1 && r.end === 3 && r.depth === 1)).toBe(true);
  });

  it("ignores single-line scopes", async () => {
    const code = ["const f = () => 1;", "const g = () => 2;"].join("\n");
    const ranges = await stickyRanges(code, "typescript");
    expect(ranges).toEqual([]);
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

describe("stickyRanges — unsupported", () => {
  it("returns nothing for a language without an on-device parser", async () => {
    expect(await stickyRanges("package main\nfunc main() {}\n", "go")).toEqual([]);
  });
});
