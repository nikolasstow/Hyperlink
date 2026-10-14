import { readFileSync } from "node:fs";
import { createHighlighterCore, type GrammarState, type HighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import typescript from "shiki/langs/typescript.mjs";
import githubDark from "shiki/themes/github-dark.mjs";
import { beforeAll, describe, expect, it } from "vitest";
import { type Sliced, Superseded, tokenizeInSlices } from "./slicedTokens";

interface Token {
  readonly content: string;
  readonly color: string | undefined;
}

let hl: HighlighterCore;
beforeAll(async () => {
  hl = await createHighlighterCore({ engine: createJavaScriptRegexEngine({ forgiving: true }), themes: [githubDark], langs: [typescript] });
});

const source = readFileSync(new URL("./files/CodeEditor.tsx", import.meta.url), "utf8");

/** The whole text coloured in one go, as Shiki does it. */
const whole = (code: string): ReadonlyArray<ReadonlyArray<Token>> =>
  hl.codeToTokens(code, { lang: "typescript", theme: "github-dark" }).tokens.map((line) => line.map((token) => ({ content: token.content, color: token.color })));

/** Colour in slices, counting the lines coloured. */
const sliced = async (code: string, previous?: Sliced<Token, GrammarState>, stillWanted: () => boolean = () => true) => {
  let coloured = 0;
  const result = await tokenizeInSlices<Token, GrammarState>({
    code,
    previous,
    line: (text, state) => {
      coloured++;
      const out = hl.codeToTokens(text, { lang: "typescript", theme: "github-dark", ...(state === undefined ? {} : { grammarState: state }) });
      return { tokens: (out.tokens[0] ?? []).map((token) => ({ content: token.content, color: token.color })), state: out.grammarState };
    },
    sameState: (a, b) => {
      if (a === b) return true;
      const stackA = a?.getInternalStack("github-dark");
      const stackB = b?.getInternalStack("github-dark");
      return stackA !== undefined && stackB !== undefined && stackA.equals(stackB);
    },
    budgetMs: 1,
    pause: () => new Promise((resolve) => setTimeout(resolve, 0)),
    stillWanted,
  });
  return { result, coloured };
};

const lines = source.split("\n");
const edited = (at: number, replace: number, insert: ReadonlyArray<string>): string => [...lines.slice(0, at), ...insert, ...lines.slice(at + replace)].join("\n");
/** A comment line well into the file: deleting it leaves the rest reading alike. */
const aComment = lines.findIndex((line, index) => index > 40 && line.trim().startsWith("//"));

describe("tokenizeInSlices", () => {
  it("colours as Shiki does the whole text at once", async () => {
    const { result } = await sliced(source);
    expect(result.lines).toEqual(whole(source));
  });

  it("after an edit, colours only the lines about it, and the result is as fresh", async () => {
    const { result: first } = await sliced(source);
    for (const code of [edited(120, 1, ["  const changed = 1;"]), edited(200, 0, ["// a new line", "const more = 2;"]), edited(aComment, 1, [])]) {
      const { result, coloured } = await sliced(code, first);
      expect(result.lines).toEqual(whole(code));
      expect(coloured).toBeLessThan(10);
    }
  });

  it("an edit that changes how the rest reads colours on through it", async () => {
    const { result: first } = await sliced(source);
    const code = edited(100, 0, ["/*"]);
    const { result, coloured } = await sliced(code, first);
    expect(result.lines).toEqual(whole(code));
    expect(coloured).toBeGreaterThan(lines.length - 110);
    // Closing it again comes back to the first colouring quickly.
    const { result: closed, coloured: again } = await sliced(edited(100, 0, ["/* */"]), result);
    expect(closed.lines).toEqual(whole(edited(100, 0, ["/* */"])));
    expect(again).toBeGreaterThan(lines.length - 110);
  });

  it("stops once a newer text came", async () => {
    await expect(sliced(source, undefined, () => false)).rejects.toBeInstanceOf(Superseded);
  });
});
