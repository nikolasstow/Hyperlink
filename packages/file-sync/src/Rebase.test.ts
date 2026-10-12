import { describe, expect, it } from "vitest";
import * as Rebase from "./Rebase";
import * as TextChange from "./TextChange";

const base = ["import a", "", "const x = 1", "const y = 2", "", "export { x, y }"].join("\n");

const rebaseTexts = (mine: string, theirs: string): Rebase.Rebased =>
  Rebase.rebase(base, TextChange.diff(base, mine), TextChange.diff(base, theirs));

const edit = (text: string, line: number, to: string): string => {
  const lines = text.split("\n");
  lines[line] = to;
  return lines.join("\n");
};

describe("Rebase", () => {
  it("merges edits on different lines", () => {
    const mine = edit(base, 2, "const x = 10");
    const theirs = edit(base, 3, "const y = 20");
    const rebased = rebaseTexts(mine, theirs);
    expect(rebased.conflicts).toEqual([]);
    expect(rebased.text).toBe(edit(mine, 3, "const y = 20"));
    expect(TextChange.apply(TextChange.apply(base, TextChange.diff(base, theirs)), rebased.changes)).toBe(rebased.text);
  });

  it("keeps their text and reports mine when both touch a line", () => {
    const mine = edit(base, 2, "const x = 10");
    const theirs = edit(base, 2, "const x = 100");
    const rebased = rebaseTexts(mine, theirs);
    expect(rebased.text).toBe(theirs);
    expect(rebased.conflicts).toHaveLength(1);
    const [conflict] = rebased.conflicts;
    expect(conflict.theirs).toBe("const x = 100");
    expect(conflict.mine).toBe("const x = 10");
    expect(rebased.text.slice(conflict.from, conflict.to)).toBe("const x = 100");
  });

  it("is not a conflict when both made the same edit", () => {
    const same = edit(base, 2, "const x = 3");
    const rebased = rebaseTexts(same, same);
    expect(rebased.conflicts).toEqual([]);
    expect(rebased.text).toBe(same);
  });

  it("places a conflict past my surviving edits before it", () => {
    const mine = edit(edit(base, 0, "import aaaaaaa"), 3, "const y = 3");
    const theirs = edit(base, 3, "const y = 4");
    const rebased = rebaseTexts(mine, theirs);
    expect(rebased.text).toBe(edit(theirs, 0, "import aaaaaaa"));
    const [conflict] = rebased.conflicts;
    expect(rebased.text.slice(conflict.from, conflict.to)).toBe("const y = 4");
    expect(conflict.mine).toBe("const y = 3");
  });

  it("merges my typing around an agent's rewrite of other lines", () => {
    const theirs = ["import a", "import b", "", "const x = 1", "const y = 2", "const z = 3", "", "export { x, y, z }"].join("\n");
    const mine = edit(base, 1, "// notes");
    const rebased = rebaseTexts(mine, theirs);
    expect(rebased.conflicts).toEqual([]);
    expect(rebased.text).toBe(["import a", "import b", "// notes", "const x = 1", "const y = 2", "const z = 3", "", "export { x, y, z }"].join("\n"));
  });

  it("joins lines into one conflict when a change spans them", () => {
    const mine = edit(base, 3, "const y = 9");
    const theirs = base.replace("const x = 1\nconst y = 2", "const [x, y] = [1, 2]");
    const rebased = rebaseTexts(mine, theirs);
    expect(rebased.text).toBe(theirs);
    const [conflict] = rebased.conflicts;
    expect(conflict.theirs).toBe("const [x, y] = [1, 2]");
    expect(conflict.mine).toBe("const x = 1\nconst y = 9");
  });

  it("with nothing of mine, is their text", () => {
    const theirs = edit(base, 5, "export {}");
    const rebased = rebaseTexts(base, theirs);
    expect(rebased).toEqual({
      text: theirs,
      changes: [],
      conflicts: [],
    });
  });

  it("with nothing of theirs, is my text", () => {
    const mine = edit(base, 5, "export {}");
    const rebased = rebaseTexts(mine, base);
    expect(rebased.text).toBe(mine);
    expect(rebased.conflicts).toEqual([]);
  });
});

describe("Rebase, randomized", () => {
  const random = (seed: number) => {
    let state = seed;
    return (n: number): number => {
      state = (state * 1103515245 + 12345) % 2147483648;
      return state % n;
    };
  };
  const words = ["a", "bb", "ccc", "\n", "\n", " ", "😀"];
  const randomText = (next: (n: number) => number, length: number): string =>
    Array.from({ length }, () => words[next(words.length)]).join("");
  /** Replace a random slice of `text`. */
  const mutate = (next: (n: number) => number, text: string): string => {
    const from = next(text.length + 1);
    const to = from + next(text.length - from + 1);
    return text.slice(0, from) + randomText(next, next(4)) + text.slice(to);
  };

  it("keeps the result, the changes and the conflicts consistent", () => {
    const next = random(42);
    for (let i = 0; i < 2000; i++) {
      const base = randomText(next, next(30));
      const mineChanges = TextChange.diff(base, mutate(next, base));
      const theirsChanges = TextChange.diff(base, mutate(next, base));
      const theirText = TextChange.apply(base, theirsChanges);
      const rebased = Rebase.rebase(base, mineChanges, theirsChanges);
      expect(TextChange.isValid(theirText.length, rebased.changes)).toBe(true);
      expect(TextChange.apply(theirText, rebased.changes)).toBe(rebased.text);
      for (const conflict of rebased.conflicts) {
        expect(rebased.text.slice(conflict.from, conflict.to)).toBe(conflict.theirs);
      }
      // What survives of mine is mine, in order: an edit is moved or dropped
      // (a conflict, or the same edit as theirs), never rewritten.
      const inserts = mineChanges.map((change) => change.insert);
      let at = 0;
      for (const change of rebased.changes) {
        while (at < inserts.length && inserts[at] !== change.insert) at++;
        expect(at).toBeLessThan(inserts.length);
        at++;
      }
    }
  });

  it("is mine with nothing of theirs, and theirs with nothing of mine", () => {
    const next = random(9);
    for (let i = 0; i < 500; i++) {
      const base = randomText(next, next(30));
      const mine = mutate(next, base);
      expect(Rebase.rebase(base, TextChange.diff(base, mine), []).text).toBe(mine);
      expect(Rebase.rebase(base, [], TextChange.diff(base, mine)).text).toBe(mine);
    }
  });
});

describe("Rebase, whole-line inserts", () => {
  it("puts my edit after lines an agent added at the end of the line above", () => {
    const base = "one\ntwo\nthree";
    const mine = "one\nTWO\nthree";
    const rebased = Rebase.rebase(base, TextChange.diff(base, mine), [
      new TextChange.TextChange({
        from: 3,
        to: 3,
        insert: "\nadded",
      }),
    ]);
    expect(rebased.conflicts).toEqual([]);
    expect(rebased.text).toBe("one\nadded\nTWO\nthree");
  });

  it("conflicts when an agent inserts lines at a line break my change spans", () => {
    const base = "one\ntwo\nthree";
    const mine = "one two\nthree";
    const rebased = Rebase.rebase(base, TextChange.diff(base, mine), [
      new TextChange.TextChange({
        from: 4,
        to: 4,
        insert: "added\n",
      }),
    ]);
    expect(rebased.conflicts).toHaveLength(1);
    expect(rebased.text).toBe("one\nadded\ntwo\nthree");
  });
});
