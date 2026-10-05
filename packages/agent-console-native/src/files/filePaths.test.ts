import { describe, expect, it } from "vitest";
import { isRootPath, shownPath } from "./filePaths";

describe("shownPath", () => {
  it("shows a path from the root, the root's name first", () => {
    expect(shownPath("/Users/me/hyperlink/src/files", "/Users/me/hyperlink", false)).toBe("hyperlink/src/files");
    expect(shownPath("/Users/me/hyperlink", "/Users/me/hyperlink/", false)).toBe("hyperlink");
  });

  it("shows it in full when asked, or when it is outside the root", () => {
    expect(shownPath("/Users/me/hyperlink/src", "/Users/me/hyperlink", true)).toBe("/Users/me/hyperlink/src");
    expect(shownPath("/Users/me/hyperlinked/src", "/Users/me/hyperlink", false)).toBe("/Users/me/hyperlinked/src");
  });
});

describe("isRootPath", () => {
  it("is the root, with or without a trailing slash, and nothing under it", () => {
    expect(isRootPath("/r/app", "/r/app/")).toBe(true);
    expect(isRootPath("/r/app/", "/r/app")).toBe(true);
    expect(isRootPath("/r/app/src", "/r/app")).toBe(false);
    expect(isRootPath("/r/apple", "/r/app")).toBe(false);
  });
});
