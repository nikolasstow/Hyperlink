import { Result } from "effect";
import { describe, expect, it } from "vitest";
import { matchesWhen } from "./when";

const holds = (clause: string | undefined, context: Record<string, unknown>) => matchesWhen(clause, new Map(Object.entries(context)));

describe("when clauses", () => {
  it("holds for an absent or empty clause", () => {
    expect(holds(undefined, {})).toEqual(Result.succeed(true));
    expect(holds("  ", {})).toEqual(Result.succeed(true));
  });

  it("matches the view/item clauses menus use", () => {
    const clause = "view == npm && viewItem == script";
    expect(holds(clause, { view: "npm", viewItem: "script" })).toEqual(Result.succeed(true));
    expect(holds(clause, { view: "npm", viewItem: "packageJSON" })).toEqual(Result.succeed(false));
    expect(holds(clause, { view: "other", viewItem: "script" })).toEqual(Result.succeed(false));
  });

  it("gives && precedence over ||, and honours parentheses and !", () => {
    expect(holds("a || b && c", { a: true, b: false, c: false })).toEqual(Result.succeed(true));
    expect(holds("(a || b) && c", { a: true, b: false, c: false })).toEqual(Result.succeed(false));
    expect(holds("!a", { a: false })).toEqual(Result.succeed(true));
  });

  it("supports !=, quoted values and regex matches", () => {
    expect(holds("viewItem != script", { viewItem: "folder" })).toEqual(Result.succeed(true));
    expect(holds("resourceFilename == 'package.json'", { resourceFilename: "package.json" })).toEqual(Result.succeed(true));
    expect(holds("resourceFilename =~ /^package\\.json$/i", { resourceFilename: "Package.JSON" })).toEqual(Result.succeed(true));
  });

  it("reports a clause it cannot parse instead of guessing", () => {
    expect(Result.isFailure(holds("view == ", {}))).toBe(true);
    expect(Result.isFailure(holds("(view == npm", { view: "npm" }))).toBe(true);
  });
});
