import { describe, expect, it } from "vitest";
import { favoriteRepo, favoriteSession, isFavorite, toggled } from "./model";

describe("toggled", () => {
  it("adds a favorite at the end", () => {
    expect(toggled([favoriteSession("a")], favoriteRepo("app"))).toEqual([favoriteSession("a"), favoriteRepo("app")]);
  });

  it("takes out one that is there, leaving the rest in order", () => {
    expect(toggled([favoriteSession("a"), favoriteRepo("app"), favoriteSession("b")], favoriteRepo("app"))).toEqual([favoriteSession("a"), favoriteSession("b")]);
  });

  it("tells a session from a repo of the same name", () => {
    expect(isFavorite([favoriteSession("app")], favoriteRepo("app"))).toBe(false);
    expect(isFavorite([favoriteRepo("app")], favoriteRepo("app"))).toBe(true);
  });
});
