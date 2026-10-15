import { describe, expect, it } from "vitest";
import { lineStarts, offsetOf, positionOf } from "./positions";

const text = "ab\nc✓d\n\nlast";
const starts = lineStarts(text);

describe("positions", () => {
  it("goes both ways", () => {
    for (let offset = 0; offset <= text.length; offset++) expect(offsetOf(text, starts, positionOf(starts, offset))).toBe(offset);
    expect(positionOf(starts, 4)).toEqual({ line: 1, character: 1 });
    expect(offsetOf(text, starts, { line: 3, character: 2 })).toBe(10);
  });

  it("keeps a loose position inside its line and the text", () => {
    expect(offsetOf(text, starts, { line: 0, character: 99 })).toBe(2);
    expect(offsetOf(text, starts, { line: 99, character: 99 })).toBe(text.length);
  });
});
