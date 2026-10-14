import { describe, expect, it } from "vitest";
import { parsePairingLink } from "./pairingLink";

describe("parsePairingLink", () => {
  it("reads the code and every address, in order", () => {
    const link = "doubleagenteta://pair?code=E4M9DP3D&url=http%3A%2F%2F100.67.32.32%3A5298&url=http%3A%2F%2F192.168.1.40%3A5298";
    expect(parsePairingLink(link)).toEqual({ code: "E4M9DP3D", urls: ["http://100.67.32.32:5298", "http://192.168.1.40:5298"] });
  });

  it("takes the path form too", () => {
    expect(parsePairingLink("doubleagent:///pair?code=A&url=http://h:1")).toEqual({ code: "A", urls: ["http://h:1"] });
  });

  it("is not a pairing without a code, an address, or the pair target", () => {
    expect(parsePairingLink("doubleagent://pair?url=http://h:1")).toBeUndefined();
    expect(parsePairingLink("doubleagent://pair?code=A")).toBeUndefined();
    expect(parsePairingLink("doubleagent://session?code=A&url=http://h:1")).toBeUndefined();
    expect(parsePairingLink("not a link")).toBeUndefined();
  });

  it("drops addresses that are not http", () => {
    expect(parsePairingLink("doubleagent://pair?code=A&url=javascript:alert(1)&url=http://h:1")).toEqual({ code: "A", urls: ["http://h:1"] });
  });
});

describe("originOf", () => {
  it("is the scheme, host and port of an http(s) URL", async () => {
    const { originOf } = await import("./serverTokens");
    expect(originOf("http://100.67.32.32:5298/opencode/session?x=1")).toBe("http://100.67.32.32:5298");
    expect(originOf("https://example.com")).toBe("https://example.com");
    expect(originOf("doubleagent://pair")).toBeUndefined();
  });
});
