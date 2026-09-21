/**
 * The bridge between React Native and the code surface. Everything here is pure
 * and runs without a device: the parsing in both directions, the escaping that
 * keeps file content from breaking an injected script, and the language table
 * that has to agree with the native Shiki path.
 */
import { describe, expect, it } from "vitest";
import {
  parseHostMessage,
  parseSurfaceMessage,
  SURFACE_GLOBAL,
  monacoThemeName,
  SURFACE_LANGUAGES,
  surfaceLanguageOf,
  toInjectedScript,
  type HostMessage,
} from "./codeSurfaceProtocol";

/** The two characters by code point, so this file contains neither. */
const LINE_SEPARATOR = String.fromCharCode(0x2028);
const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029);

describe("parseSurfaceMessage", () => {
  it("reads every message the surface sends", () => {
    expect(parseSurfaceMessage('{"kind":"ready"}')).toEqual({ kind: "ready" });
    expect(parseSurfaceMessage('{"kind":"linkActivated","url":"https://example.com"}')).toEqual({
      kind: "linkActivated",
      url: "https://example.com",
    });
    expect(parseSurfaceMessage('{"kind":"contentHeight","height":420}')).toEqual({ kind: "contentHeight", height: 420 });
    expect(parseSurfaceMessage('{"kind":"error","message":"boom"}')).toEqual({ kind: "error", message: "boom" });
    expect(parseSurfaceMessage('{"kind":"selectionChanged","text":"x","startLine":1,"endLine":2}')).toEqual({
      kind: "selectionChanged",
      text: "x",
      startLine: 1,
      endLine: 2,
    });
  });

  it("drops anything malformed rather than throwing", () => {
    expect(parseSurfaceMessage("not json")).toBeUndefined();
    expect(parseSurfaceMessage("null")).toBeUndefined();
    expect(parseSurfaceMessage("[]")).toBeUndefined();
    expect(parseSurfaceMessage('{"kind":"nope"}')).toBeUndefined();
  });

  it("drops a known kind whose fields are wrong", () => {
    expect(parseSurfaceMessage('{"kind":"contentHeight","height":"tall"}')).toBeUndefined();
    expect(parseSurfaceMessage('{"kind":"linkActivated"}')).toBeUndefined();
    expect(parseSurfaceMessage('{"kind":"selectionChanged","text":"x","startLine":1}')).toBeUndefined();
  });
});

describe("parseHostMessage", () => {
  const roundTrip = (message: HostMessage): HostMessage | undefined => parseHostMessage(JSON.stringify(message));

  it("round-trips every message the host sends", () => {
    const messages: ReadonlyArray<HostMessage> = [
      { kind: "setContent", content: "const a = 1\n", language: "typescript", version: 3 },
      { kind: "setTheme", theme: "github-dark" },
      { kind: "setTheme", theme: { name: "My Theme", type: "dark", colors: { "editor.background": "#1e1e1e" } } },
      { kind: "setFont", family: "Menlo", size: 12.5 },
      { kind: "setFont", family: "Berkeley", size: 13, source: "data:font/ttf;base64,AAAA" },
      { kind: "scrollTo", line: 42 },
      { kind: "setReadOnly", readOnly: true },
    ];
    for (const message of messages) expect(roundTrip(message)).toEqual(message);
  });

  it("keeps a theme document whole, including keys it knows nothing about", () => {
    const parsed = parseHostMessage(
      JSON.stringify({ kind: "setTheme", theme: { name: "T", somethingNew: [1, 2], tokenColors: [] } }),
    );
    expect(parsed).toEqual({ kind: "setTheme", theme: { name: "T", somethingNew: [1, 2], tokenColors: [] } });
  });

  it("refuses a theme with no name, since both sides address it by that", () => {
    expect(parseHostMessage('{"kind":"setTheme","theme":{"type":"dark"}}')).toBeUndefined();
  });

  it("drops a known kind whose fields are wrong", () => {
    expect(parseHostMessage('{"kind":"setContent","content":"x","language":"ts"}')).toBeUndefined();
    expect(parseHostMessage('{"kind":"setReadOnly","readOnly":"yes"}')).toBeUndefined();
    expect(parseHostMessage('{"kind":"scrollTo"}')).toBeUndefined();
  });

  it("leaves out an absent font source rather than carrying undefined", () => {
    const parsed = parseHostMessage('{"kind":"setFont","family":"Menlo","size":12}');
    expect(parsed).toEqual({ kind: "setFont", family: "Menlo", size: 12 });
    expect(parsed !== undefined && "source" in parsed).toBe(false);
  });
});

describe("toInjectedScript", () => {
  const evaluate = (script: string): unknown => {
    let received: unknown;
    const window = { [SURFACE_GLOBAL]: { receive: (raw: string) => (received = parseHostMessage(raw)) } };
    // Exactly what the WebView does with the string: evaluate it.
    new Function("window", script)(window);
    return received;
  };

  it("delivers the message the host meant to send", () => {
    const message: HostMessage = { kind: "setContent", content: "a\nb", language: "typescript", version: 1 };
    expect(evaluate(toInjectedScript(message))).toEqual(message);
  });

  it("survives content that would close a string or a script", () => {
    const content = `"'\`\\ </script> ${"${}"} \u0000`;
    const message: HostMessage = { kind: "setContent", content, language: "plaintext", version: 1 };
    expect(evaluate(toInjectedScript(message))).toEqual(message);
  });

  it("survives the line separators that are legal in JSON and were not in JavaScript", () => {
    const content = `a${LINE_SEPARATOR}b${PARAGRAPH_SEPARATOR}c`;
    const message: HostMessage = { kind: "setContent", content, language: "plaintext", version: 1 };
    expect(toInjectedScript(message)).not.toContain(LINE_SEPARATOR);
    expect(toInjectedScript(message)).not.toContain(PARAGRAPH_SEPARATOR);
    expect(evaluate(toInjectedScript(message))).toEqual(message);
  });

  it("does nothing when the surface is not up yet", () => {
    expect(() => new Function("window", toInjectedScript({ kind: "scrollTo", line: 1 }))({})).not.toThrow();
  });

  it("ends in a value iOS can serialise back", () => {
    expect(toInjectedScript({ kind: "scrollTo", line: 1 }).endsWith("true;")).toBe(true);
  });
});

describe("monacoThemeName", () => {
  // Monaco throws `Illegal theme name!` for anything outside this.
  const LEGAL = /^[a-z0-9-]+$/i;

  it("leaves a name Monaco already accepts alone", () => {
    expect(monacoThemeName("github-dark")).toBe("github-dark");
    expect(monacoThemeName("github-light")).toBe("github-light");
    expect(monacoThemeName("nord")).toBe("nord");
  });

  it("makes a theme's own display name legal", () => {
    expect(LEGAL.test(monacoThemeName("Night Owl"))).toBe(true);
    expect(LEGAL.test(monacoThemeName("Dracula Soft"))).toBe(true);
    expect(monacoThemeName("Night Owl").startsWith("night-owl-")).toBe(true);
  });

  it("makes an installed theme's file path legal, which is how one arrives", () => {
    const name = monacoThemeName("themes/Night Owl-color-theme.json");
    expect(LEGAL.test(name)).toBe(true);
  });

  it("keeps two names that slug alike apart", () => {
    expect(monacoThemeName("Night Owl")).not.toBe(monacoThemeName("night owl"));
    expect(monacoThemeName("a/b")).not.toBe(monacoThemeName("a.b"));
  });

  it("is stable, so a theme keeps its id across renders", () => {
    expect(monacoThemeName("Night Owl")).toBe(monacoThemeName("Night Owl"));
  });

  it("still returns something legal for a name with nothing usable in it", () => {
    expect(LEGAL.test(monacoThemeName("***"))).toBe(true);
    expect(LEGAL.test(monacoThemeName(""))).toBe(true);
  });

  it("does not leave a trailing separator after truncating a long name", () => {
    const name = monacoThemeName(`${"x ".repeat(60)}end`);
    expect(LEGAL.test(name)).toBe(true);
    expect(name).not.toContain("--");
  });
});

describe("surfaceLanguageOf", () => {
  it("passes through a language it has a grammar for", () => {
    for (const language of SURFACE_LANGUAGES) expect(surfaceLanguageOf(language)).toBe(language);
  });

  it("resolves the aliases the native highlighter resolves", () => {
    expect(surfaceLanguageOf("ts")).toBe("typescript");
    expect(surfaceLanguageOf("mts")).toBe("typescript");
    expect(surfaceLanguageOf("jsx")).toBe("tsx");
    expect(surfaceLanguageOf("py")).toBe("python");
    expect(surfaceLanguageOf("zsh")).toBe("bash");
    expect(surfaceLanguageOf("md")).toBe("markdown");
  });

  it("ignores case, because an extension is whatever the file was named", () => {
    expect(surfaceLanguageOf("TS")).toBe("typescript");
    expect(surfaceLanguageOf("JSON")).toBe("json");
  });

  it("falls back to Monaco's own id for anything it cannot highlight", () => {
    expect(surfaceLanguageOf("text")).toBe("plaintext");
    expect(surfaceLanguageOf("cobol")).toBe("plaintext");
    expect(surfaceLanguageOf("")).toBe("plaintext");
  });
});
