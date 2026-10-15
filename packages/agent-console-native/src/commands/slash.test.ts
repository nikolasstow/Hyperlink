import type { Commands } from "agent-console-protocol";
import { describe, expect, it } from "vitest";
import { acceptedByKey, invocationOf, invocationWith, matches, slashQuery, withName } from "./slash";

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

describe("acceptedByKey", () => {
  it("accepts the top match on space or Return", () => {
    expect(acceptedByKey("/re", "/re ", entries)?.name).toBe("review");
    expect(acceptedByKey("/re", "/re\n", entries)?.name).toBe("review");
    expect(acceptedByKey("/UNS", "/UNS ", entries)?.name).toBe("unslop");
  });

  it("accepts a name typed in full as itself, though another sorts first", () => {
    expect(acceptedByKey("/report", "/report ", [skill("reportage"), ...entries])?.name).toBe("report");
  });

  it("leaves the key alone with no match, after a bare /, or anywhere else", () => {
    expect(acceptedByKey("/zz", "/zz ", entries)).toBeUndefined();
    expect(acceptedByKey("/", "/\n", entries)).toBeUndefined();
    expect(acceptedByKey("/review fix", "/review fix ", entries)).toBeUndefined();
    expect(acceptedByKey("/re", "/rev", entries)).toBeUndefined();
  });
});

describe("withName", () => {
  it("puts the accepted name before what was typed after it", () => {
    expect(withName(skill("unslop"), "this paragraph")).toBe("/unslop this paragraph");
    expect(withName(skill("unslop"), "")).toBe("/unslop");
    expect(invocationOf(withName(command("review"), "last"), entries)).toEqual(invocationWith(command("review"), "last"));
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
