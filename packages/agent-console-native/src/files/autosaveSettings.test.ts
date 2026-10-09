import { describe, expect, it } from "vitest";
import { type FileScopeContext, resolveAutosave, resolutionOrder } from "./autosaveSettings";

const ctx: FileScopeContext = { path: "/repo/src/a/b.ts", repo: "repo", server: "mac" };

describe("resolutionOrder", () => {
  it("goes nearest → farthest: file, folders (longest first), repo, server, app", () => {
    expect(resolutionOrder(ctx)).toEqual([
      "file:/repo/src/a/b.ts",
      "folder:/repo/src/a",
      "folder:/repo/src",
      "folder:/repo",
      "repo:repo",
      "server:mac",
      "app",
    ]);
  });

  it("omits repo/server when absent", () => {
    expect(resolutionOrder({ path: "/x/y.ts" })).toEqual(["file:/x/y.ts", "folder:/x", "app"]);
  });
});

describe("resolveAutosave", () => {
  it("defaults to on (app-wide) with nothing set", () => {
    expect(resolveAutosave(new Map(), ctx)).toBe(true);
  });

  it("the nearest explicit scope wins", () => {
    // app off, but this repo back on, and this one file off again.
    expect(resolveAutosave(new Map([["app", false]]), ctx)).toBe(false);
    expect(resolveAutosave(new Map([["app", false], ["repo:repo", true]]), ctx)).toBe(true);
    expect(resolveAutosave(new Map([["app", false], ["repo:repo", true], ["file:/repo/src/a/b.ts", false]]), ctx)).toBe(false);
  });

  it("a nearer folder overrides a farther one", () => {
    expect(resolveAutosave(new Map([["folder:/repo", false], ["folder:/repo/src", true]]), ctx)).toBe(true);
  });
});
