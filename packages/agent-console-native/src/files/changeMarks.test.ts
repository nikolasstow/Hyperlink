import { describe, expect, it } from "vitest";
import { changeMarks } from "./changeMarks";

const demo = ["// demo", "", "export const count = 1;", "", "export const colors = [];", ""].join("\n");

/** The marked lines' text, for reading the tests. */
const marked = (after: string): ReadonlyArray<string> => changeMarks(demo, after).map((mark) => `${mark.kind}:${after.slice(mark.from, mark.to)}`);

describe("changeMarks", () => {
  it("marks nothing when nothing changed", () => {
    expect(changeMarks(demo, demo)).toEqual([]);
  });

  it("marks an edited line as changed", () => {
    expect(marked(demo.replace("count = 1", "count = 2"))).toEqual(["modified:export const count = 2;"]);
  });

  it("marks a new line after another as added, not the line before it", () => {
    expect(marked(demo.replace("count = 1;", "count = 1;\nexport const limit = 10;"))).toEqual(["added:export const limit = 10;"]);
  });

  it("marks a new line before another as added, not the line after it", () => {
    expect(marked(demo.replace("export const colors", "// colours\nexport const colors"))).toEqual(["added:// colours"]);
  });

  it("marks several new lines as one added block", () => {
    expect(marked(`${demo}export function f() {\n  return 1;\n}\n`)).toEqual(["added:export function f() {\n  return 1;\n}"]);
  });

  it("marks removed lines as a deletion at the line that now follows them", () => {
    const after = demo.replace("export const count = 1;\n\n", "");
    const marks = changeMarks(demo, after);
    expect(marks).toEqual([
      {
        kind: "deleted",
        from: after.indexOf("export const colors"),
        to: after.indexOf("export const colors"),
      },
    ]);
  });

  it("marks lines removed at the very end at the end of the text", () => {
    const after = demo.replace("export const colors = [];\n", "");
    expect(changeMarks(demo, after)).toEqual([
      {
        kind: "deleted",
        from: after.length,
        to: after.length,
      },
    ]);
  });

  it("marks separate places separately", () => {
    const after = demo.replace("// demo", "// live demo").replace("colors = []", 'colors = ["red"]');
    expect(marked(after)).toEqual(["modified:// live demo", 'modified:export const colors = ["red"];']);
  });

  it("marks a line replaced by more lines as changed across all of them", () => {
    expect(marked(demo.replace("export const count = 1;", "export const count = 2;\nexport const limit = 3;"))).toEqual([
      "modified:export const count = 2;\nexport const limit = 3;",
    ]);
  });
});
