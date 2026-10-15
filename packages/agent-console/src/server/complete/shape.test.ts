import { describe, expect, it } from "vitest";
import { isOwnLine, shape } from "./shape";
import { snippetsFor } from "./snippets";

describe("shape", () => {
  it("keeps one line in the middle of a line", () => {
    expect(shape("a + b);\nconst c = 2;", "  sum(", false)).toBe("a + b);");
  });

  it("keeps a block on a line of its own, up to where the code steps out of it", () => {
    const prefix = "function f() {\n  if (x) {\n    ";
    expect(shape("y();\n    z();\n  }\n  w();", prefix, true)).toBe("y();\n    z();");
  });

  it("knows a line of its own", () => {
    expect(isOwnLine("a\n    ", "\n}")).toBe(true);
    expect(isOwnLine("a\n  foo(", ")\n")).toBe(false);
  });
});

describe("snippetsFor", () => {
  it("gives the chunks of other files most like the code at the caret", () => {
    const files = [
      { path: "/r/here.ts", text: "const total = sumValues(values);" },
      { path: "/r/math.ts", text: "export const sumValues = (values: number[]) => values.reduce((a, b) => a + b, 0);" },
      { path: "/r/ui.ts", text: "export const Button = () => render(label);" },
    ];
    const found = snippetsFor("/r/here.ts", "const total = sumValues(values", files);
    expect(found.map((snippet) => snippet.path)).toEqual(["/r/math.ts"]);
  });
});
