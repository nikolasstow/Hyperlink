import { describe, expect, it } from "vitest";
import { lineAtTop, markdownSections } from "./markdownSections";
import { stickyRanges } from "./stickyRanges";

const doc = ["intro", "", "# One", "text", "```", "# not a heading", "```", "## Two", "more", "# Three", "end"].join("\n");

describe("markdownSections", () => {
  it("cuts before each heading, not at a # in a code fence", async () => {
    const sections = markdownSections(doc, await stickyRanges(doc, "markdown"));
    expect(sections.map((section) => section.line)).toEqual([0, 2, 7, 9]);
    expect(sections[1]?.text).toBe(["# One", "text", "```", "# not a heading", "```"].join("\n"));
    expect(sections.map((section) => section.text).join("\n")).toBe(doc);
  });

  it("has no empty section above a heading on the first line", async () => {
    const text = "# Top\nbody";
    expect(markdownSections(text, await stickyRanges(text, "markdown")).map((section) => section.line)).toEqual([0]);
  });
});

describe("lineAtTop", () => {
  it("is the last section that has reached the top", () => {
    const sections = [
      { line: 0, text: "a" },
      { line: 5, text: "b" },
      { line: 9, text: "c" },
    ];
    expect(lineAtTop(sections, [0, 100, 300], 0)).toBe(0);
    expect(lineAtTop(sections, [0, 100, 300], 150)).toBe(5);
    expect(lineAtTop(sections, [0, 100, undefined], 999)).toBe(5);
  });
});
