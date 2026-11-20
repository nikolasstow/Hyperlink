import { describe, expect, it } from "vitest";
import { CHANGELOG, latestVersion, unseenEntries } from "./changelog";

describe("changelog", () => {
  it("has unique versions, newest first, each with lines", () => {
    const versions = CHANGELOG.map((entry) => entry.version);
    expect(new Set(versions).size).toBe(versions.length);
    expect([...versions].sort((a, b) => b - a)).toEqual(versions);
    CHANGELOG.forEach((entry) => expect(entry.lines.length).toBeGreaterThan(0));
  });

  it("shows only the entries above the last version the owner closed", () => {
    expect(unseenEntries(CHANGELOG, latestVersion(CHANGELOG))).toEqual([]);
    expect(unseenEntries(CHANGELOG, latestVersion(CHANGELOG) - 1).map((entry) => entry.version)).toEqual([latestVersion(CHANGELOG)]);
    expect(unseenEntries(CHANGELOG, undefined)).toHaveLength(CHANGELOG.length);
  });
});
