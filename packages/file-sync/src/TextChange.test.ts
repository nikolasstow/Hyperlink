import { describe, expect, it } from "vitest";
import * as TextChange from "./TextChange";

const change = (from: number, to: number, insert: string): TextChange.TextChange =>
  new TextChange.TextChange({
    from,
    to,
    insert,
  });

/** A deterministic pseudo-random source, so a failing case reproduces. */
const random = (seed: number) => {
  let state = seed;
  return (n: number): number => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state % n;
  };
};

const alphabet = ["a", "b", "c", "\n", " ", "é", "😀"];

const randomText = (next: (n: number) => number, length: number): string =>
  Array.from({ length }, () => alphabet[next(alphabet.length)]).join("");

describe("TextChange", () => {
  it("applies a change set in base positions", () => {
    const text = "hello world";
    expect(TextChange.apply(text, [change(0, 5, "goodbye"), change(6, 11, "moon")])).toBe("goodbye moon");
    expect(TextChange.apply(text, [])).toBe(text);
    expect(TextChange.apply(text, [change(11, 11, "!")])).toBe("hello world!");
  });

  it("diffs into a change set that rebuilds the target", () => {
    const next = random(7);
    for (let i = 0; i < 300; i++) {
      const before = randomText(next, next(40));
      const after = randomText(next, next(40));
      const changes = TextChange.diff(before, after);
      expect(TextChange.isValid(before.length, changes)).toBe(true);
      expect(TextChange.apply(before, changes)).toBe(after);
    }
  });

  it("merges an adjacent delete and insert into one change", () => {
    expect(TextChange.diff("let a = 1", "let a = 2")).toEqual([change(8, 9, "2")]);
    expect(TextChange.diff("same", "same")).toEqual([]);
  });

  it("rejects change sets that are out of bounds, backward or overlapping", () => {
    expect(TextChange.isValid(5, [change(0, 6, "")])).toBe(false);
    expect(TextChange.isValid(5, [change(3, 2, "")])).toBe(false);
    expect(TextChange.isValid(5, [change(0, 3, ""), change(2, 4, "")])).toBe(false);
    expect(TextChange.isValid(5, [change(0, 2, "x"), change(2, 2, "y")])).toBe(true);
  });

  it("maps positions through changes", () => {
    const changes = [change(2, 4, "XYZ"), change(6, 6, "!")];
    expect(TextChange.mapPosition(changes, 0)).toBe(0);
    expect(TextChange.mapPosition(changes, 2)).toBe(2);
    expect(TextChange.mapPosition(changes, 3)).toBe(5);
    expect(TextChange.mapPosition(changes, 4)).toBe(5);
    expect(TextChange.mapPosition(changes, 5)).toBe(6);
    expect(TextChange.mapPosition(changes, 6)).toBe(7);
    expect(TextChange.mapPosition(changes, 6, true)).toBe(8);
    expect(TextChange.mapPosition(changes, 8)).toBe(10);
  });
});
