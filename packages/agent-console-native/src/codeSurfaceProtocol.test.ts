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
  DOCUMENT_BUDGET,
  evictionsFor,
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
      { kind: "openDocument", path: "/src/a.ts", text: "const a = 1\n", language: "typescript", version: 3 },
      { kind: "showDocument", path: "/src/a.ts" },
      { kind: "closeDocument", path: "/src/a.ts" },
      { kind: "closeAllExcept", path: "/src/a.ts" },
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
    expect(parseHostMessage('{"kind":"openDocument","path":"/a","text":"x","language":"ts"}')).toBeUndefined();
    expect(parseHostMessage('{"kind":"showDocument"}')).toBeUndefined();
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
    const message: HostMessage = { kind: "openDocument", path: "/a.ts", text: "a\nb", language: "typescript", version: 1 };
    expect(evaluate(toInjectedScript(message))).toEqual(message);
  });

  it("survives content that would close a string or a script", () => {
    const content = `"'\`\\ </script> ${"${}"} \u0000`;
    const message: HostMessage = { kind: "openDocument", path: "/a.txt", text: content, language: "plaintext", version: 1 };
    expect(evaluate(toInjectedScript(message))).toEqual(message);
  });

  it("survives the line separators that are legal in JSON and were not in JavaScript", () => {
    const content = `a${LINE_SEPARATOR}b${PARAGRAPH_SEPARATOR}c`;
    const message: HostMessage = { kind: "openDocument", path: "/a.txt", text: content, language: "plaintext", version: 1 };
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

describe("evictionsFor", () => {
  const doc = (path: string, bytes: number, shownAt: number) => ({ path, bytes, shownAt });

  it("keeps everything while the budget covers it", () => {
    expect(evictionsFor([doc("a", 1000, 1), doc("b", 1000, 2)], "b")).toEqual([]);
  });

  it("lets go of the least recently shown first", () => {
    const held = [doc("old", 3_000_000, 1), doc("newer", 3_000_000, 2), doc("visible", 100, 3)];
    expect(evictionsFor(held, "visible")).toEqual(["old"]);
  });

  it("never evicts the file being looked at, whatever it costs", () => {
    const held = [doc("huge", 9_000_000, 1), doc("small", 10, 2)];
    expect(evictionsFor(held, "huge")).toEqual(["small"]);
  });

  it("evicts on the count cap even when the bytes are trivial", () => {
    const held = Array.from({ length: DOCUMENT_BUDGET.count + 3 }, (_, i) => doc(`f${i}`, 10, i));
    expect(evictionsFor(held, `f${DOCUMENT_BUDGET.count + 2}`)).toEqual(["f0", "f1", "f2"]);
  });

  it("stops as soon as both limits are met rather than emptying the list", () => {
    const held = [doc("a", 3_000_000, 1), doc("b", 3_000_000, 2), doc("c", 100, 3)];
    expect(evictionsFor(held, "c")).toEqual(["a"]);
  });

  it("evicts nothing from an empty surface", () => {
    expect(evictionsFor([], undefined)).toEqual([]);
  });

  it("will evict every held file when none of them is visible", () => {
    const held = [doc("a", 5_000_000, 1), doc("b", 5_000_000, 2)];
    expect(evictionsFor(held, undefined)).toEqual(["a", "b"]);
  });

  it("takes a budget, so a caller under memory pressure can tighten it", () => {
    const held = [doc("a", 100, 1), doc("b", 100, 2)];
    expect(evictionsFor(held, "b", { bytes: 100, count: 1 })).toEqual(["a"]);
  });
});

describe("document messages", () => {
  it("round-trips an evicted report", () => {
    expect(parseSurfaceMessage('{"kind":"documentEvicted","path":"/src/a.ts"}')).toEqual({
      kind: "documentEvicted",
      path: "/src/a.ts",
    });
  });

  it("refuses an evicted report with no path", () => {
    expect(parseSurfaceMessage('{"kind":"documentEvicted"}')).toBeUndefined();
  });

  it("refuses an open that carries no text, since the surface cannot invent it", () => {
    expect(parseHostMessage('{"kind":"openDocument","path":"/a","language":"ts","version":1}')).toBeUndefined();
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
