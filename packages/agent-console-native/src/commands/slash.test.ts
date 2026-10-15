import type { Commands } from "agent-console-protocol";
import { describe, expect, it } from "vitest";
import { invocationOf, matches, slashQuery, spaceAccepts } from "./slash";

const skill = (name: string): Commands.Entry => ({ id: `skill:${name}`, name, source: "skill" });
const command = (name: string): Commands.Entry => ({ id: `command:${name}`, name, source: "command" });
const entries = [skill("docs"), command("init"), skill("pdf"), command("review"), skill("report"), skill("unslop")];

describe("slashQuery", () => {
  it("reads the word after a leading / while it is typed", () => {
    expect(slashQuery("/")).toBe("");
    expect(slashQuery("/re")).toBe("re");
    expect(slashQuery("/re ")).toBeUndefined();
    expect(slashQuery("say /re")).toBeUndefined();
    expect(slashQuery("")).toBeUndefined();
  });
});

describe("matches", () => {
  it("puts names that start with the query before names that hold it", () => {
    expect(matches(entries, "re").map((entry) => entry.name)).toEqual(["review", "report"]);
    expect(matches(entries, "o").map((entry) => entry.name)).toEqual(["docs", "report", "unslop"]);
    expect(matches(entries, "").length).toBe(6);
  });
});

describe("spaceAccepts", () => {
  it("accepts the top match", () => {
    expect(spaceAccepts("/re", "/re ", entries)).toBe("/review ");
    expect(spaceAccepts("/UNS", "/UNS ", entries)).toBe("/unslop ");
  });

  it("leaves a plain space after an exact name, with no match, after a bare /, or anywhere else", () => {
    expect(spaceAccepts("/report", "/report ", entries)).toBeUndefined();
    expect(spaceAccepts("/zz", "/zz ", entries)).toBeUndefined();
    expect(spaceAccepts("/", "/ ", entries)).toBeUndefined();
    expect(spaceAccepts("/review fix", "/review fix ", entries)).toBeUndefined();
    expect(spaceAccepts("/re", "/rev", entries)).toBeUndefined();
  });
});

describe("invocationOf", () => {
  it("finds the entry a message's leading /name runs, and its arguments", () => {
    expect(invocationOf("/review the last commit", entries)).toEqual({ entry: command("review"), end: 7, args: "the last commit" });
    expect(invocationOf("/unslop", entries)).toEqual({ entry: skill("unslop"), end: 7, args: "" });
    expect(invocationOf("/unslop\nthis paragraph", entries)?.args).toBe("this paragraph");
  });

  it("is nothing for an unknown name or a / that does not lead", () => {
    expect(invocationOf("/nope do it", entries)).toBeUndefined();
    expect(invocationOf("please /review", entries)).toBeUndefined();
    expect(invocationOf("/ review", entries)).toBeUndefined();
  });
});
