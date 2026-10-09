import { describe, expect, it } from "vitest";
import {
  boardItems,
  fileTarget,
  fromLegacy,
  homeScope,
  isFavorited,
  repoScope,
  repoTarget,
  reordered,
  type ScopedFavorites,
  serverTarget,
  sessionTarget,
  toggled,
} from "./model";

describe("toggled", () => {
  it("adds a target to a scope's board, at the end", () => {
    const after = toggled([], homeScope, sessionTarget("a"));
    expect(boardItems(after, homeScope)).toEqual([sessionTarget("a")]);
    const after2 = toggled(after, homeScope, repoTarget("app"));
    expect(boardItems(after2, homeScope)).toEqual([sessionTarget("a"), repoTarget("app")]);
  });

  it("takes one out when it is already there, leaving the rest in order", () => {
    const start = toggled(toggled(toggled([], homeScope, sessionTarget("a")), homeScope, repoTarget("app")), homeScope, sessionTarget("b"));
    const after = toggled(start, homeScope, repoTarget("app"));
    expect(boardItems(after, homeScope)).toEqual([sessionTarget("a"), sessionTarget("b")]);
  });

  it("drops a board once its last favorite is removed", () => {
    const after = toggled(toggled([], homeScope, sessionTarget("a")), homeScope, sessionTarget("a"));
    expect(after).toEqual([]);
  });
});

describe("scope", () => {
  it("keeps the same target in different scopes independent", () => {
    const home = toggled([], homeScope, sessionTarget("a"));
    const both = toggled(home, repoScope("app"), sessionTarget("a"));
    expect(isFavorited(both, homeScope, sessionTarget("a"))).toBe(true);
    expect(isFavorited(both, repoScope("app"), sessionTarget("a"))).toBe(true);
    const offHome = toggled(both, homeScope, sessionTarget("a"));
    expect(isFavorited(offHome, homeScope, sessionTarget("a"))).toBe(false);
    expect(isFavorited(offHome, repoScope("app"), sessionTarget("a"))).toBe(true);
  });

  it("keeps each repo scope separate", () => {
    const a = toggled([], repoScope("a"), repoTarget("a"));
    const both = toggled(a, repoScope("b"), repoTarget("b"));
    expect(boardItems(both, repoScope("a"))).toEqual([repoTarget("a")]);
    expect(boardItems(both, repoScope("b"))).toEqual([repoTarget("b")]);
  });
});

describe("identity (page + input)", () => {
  it("tells a session from a repo of the same name", () => {
    expect(isFavorited([{ scope: homeScope, items: [sessionTarget("app")] }], homeScope, repoTarget("app"))).toBe(false);
    expect(isFavorited([{ scope: homeScope, items: [repoTarget("app")] }], homeScope, repoTarget("app"))).toBe(true);
  });

  it("treats the same page with different input as distinct favorites", () => {
    const two = toggled(toggled([], homeScope, fileTarget("app", "/a.ts", "a.ts")), homeScope, fileTarget("app", "/b.ts", "b.ts"));
    expect(boardItems(two, homeScope)).toHaveLength(2);
    expect(isFavorited(two, homeScope, fileTarget("app", "/a.ts", "a.ts"))).toBe(true);
    expect(isFavorited(two, homeScope, serverTarget("x"))).toBe(false);
  });
});

describe("reordered", () => {
  it("replaces a scope's order", () => {
    const start = toggled(toggled([], homeScope, sessionTarget("a")), homeScope, sessionTarget("b"));
    const after = reordered(start, homeScope, [sessionTarget("b"), sessionTarget("a")]);
    expect(boardItems(after, homeScope)).toEqual([sessionTarget("b"), sessionTarget("a")]);
  });
});

describe("fromLegacy", () => {
  it("folds the flat list into the home board, preserving order", () => {
    const boards: ScopedFavorites = fromLegacy([
      { kind: "session", id: "a" },
      { kind: "repo", name: "app" },
    ]);
    expect(boards).toEqual([{ scope: homeScope, items: [sessionTarget("a"), repoTarget("app")] }]);
  });

  it("maps an empty list to no boards", () => {
    expect(fromLegacy([])).toEqual([]);
  });
});
