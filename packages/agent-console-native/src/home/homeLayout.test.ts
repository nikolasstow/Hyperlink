import { describe, expect, it } from "vitest";
import { sessionCardSize } from "./homeLayout";

const short = "Fix the login bug";
const long = "Investigate why the dashboard loses its live data after reconnecting";

describe("sessionCardSize", () => {
  it("is small with a one-line title and nothing else", () => {
    expect(sessionCardSize({ title: short, pills: false, summary: false })).toBe("small");
  });

  it("is medium with a second title line, the pills, or the last message", () => {
    expect(sessionCardSize({ title: long, pills: false, summary: false })).toBe("medium");
    expect(sessionCardSize({ title: short, pills: true, summary: false })).toBe("medium");
    expect(sessionCardSize({ title: short, pills: false, summary: true })).toBe("medium");
  });

  it("is large with more than that", () => {
    expect(sessionCardSize({ title: short, pills: true, summary: true })).toBe("large");
    expect(sessionCardSize({ title: long, pills: true, summary: true })).toBe("large");
  });
});
