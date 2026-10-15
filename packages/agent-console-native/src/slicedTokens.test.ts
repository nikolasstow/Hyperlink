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
const sliced = async (
  code: string,
  previous?: Sliced<Token, GrammarState>,
  stillWanted: () => boolean = () => true,
  progress?: (lines: ReadonlyArray<ReadonlyArray<Token>>) => void,
) => {
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
    ...(progress === undefined ? {} : { progress }),
  });
  return { result, coloured };
};

const lines = source.split("\n");
const edited = (at: number, replace: number, insert: ReadonlyArray<string>): string => [...lines.slice(0, at), ...insert, ...lines.slice(at + replace)].join("\n");
/** A comment line well into the file: deleting it leaves the rest reading alike. */
const aComment = lines.findIndex((line, index) => index > 40 && line.trim().startsWith("//"));
/** A one-line statement in a function well into the file: replacing it, or
 * adding lines before it, leaves the rest reading alike. Found, not fixed:
 * the file is this app's own source, and changes. */
const STATEMENT = /^( +)const \w+ = [^{(\[]*;$/;
const aStatement = lines.findIndex((line, index) => index > 100 && STATEMENT.test(line));
const laterStatement = lines.findIndex((line, index) => index > aStatement + 30 && STATEMENT.test(line));
/** Lines at the indent of the statement they go by. */
const at = (index: number, insert: ReadonlyArray<string>): ReadonlyArray<string> => insert.map((line) => `${STATEMENT.exec(lines[index] ?? "")?.[1] ?? ""}${line}`);

describe("tokenizeInSlices", () => {
  it("colours as Shiki does the whole text at once", async () => {
    const { result } = await sliced(source);
    expect(result.lines).toEqual(whole(source));
  });

  it("after an edit, colours only the lines about it, and the result is as fresh", async () => {
    const { result: first } = await sliced(source);
    expect(aStatement).toBeGreaterThan(0);
    expect(laterStatement).toBeGreaterThan(0);
    for (const code of [edited(aStatement, 1, at(aStatement, ["const changed = 1;"])), edited(laterStatement, 0, at(laterStatement, ["// a new line", "const more = 2;"])), edited(aComment, 1, [])]) {
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

  it("tells the lines coloured so far as it goes, each the start of the whole", async () => {
    const seen: Array<ReadonlyArray<ReadonlyArray<Token>>> = [];
    const { result } = await sliced(source, undefined, () => true, (so) => seen.push([...so]));
    expect(seen.length).toBeGreaterThan(1);
    for (const [index, so] of seen.entries()) {
      expect(so.length).toBeGreaterThanOrEqual(seen[index - 1]?.length ?? 0);
      expect(so).toEqual(result.lines.slice(0, so.length));
    }
  });

  it("stops once a newer text came", async () => {
    await expect(sliced(source, undefined, () => false)).rejects.toBeInstanceOf(Superseded);
  });
});
