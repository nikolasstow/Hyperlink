import { describe, expect, it } from "vitest";
import { hoverParts, scopeAnchor } from "./typePreview";

const text = ["export class Store {", "  get(key: string) {", "    return getter(key);", "  }", "}"].join("\n");

describe("scopeAnchor", () => {
  it("is where the innermost scope's name is, on its header line, as a whole word", () => {
    const anchor = scopeAnchor(text, [
      { kind: "class", name: "Store", line: 0 },
      { kind: "method", name: "get", line: 1 },
    ]);
    expect(text.slice(anchor ?? 0, (anchor ?? 0) + 3)).toBe("get");
    expect(anchor).toBe(text.indexOf("  get(") + 2);
  });

  it("is nothing without a named scope, or when the name is not on its line", () => {
    expect(scopeAnchor(text, [])).toBeUndefined();
    expect(scopeAnchor(text, [{ kind: "method", name: "set", line: 1 }])).toBeUndefined();
    expect(scopeAnchor(text, [{ kind: "method", name: "get" }])).toBeUndefined();
  });
});

describe("hoverParts", () => {
  it("splits the type's code from its docs", () => {
    const parts = hoverParts("\n```typescript\nconst gen: <A>() => A\nnamespace gen\n```\nRuns a **generator**.\n\n*@since* 2.0.0");
    expect(parts.code).toEqual([{ lang: "typescript", text: "const gen: <A>() => A\nnamespace gen" }]);
    expect(parts.docs).toBe("Runs a **generator**.\n\n*@since* 2.0.0");
  });

  it("keeps docs alone, and code alone", () => {
    expect(hoverParts("Just words.")).toEqual({ code: [], docs: "Just words." });
    expect(hoverParts("```ts\nlet a: 1\n```")).toEqual({ code: [{ lang: "ts", text: "let a: 1" }], docs: "" });
  });
});
