/**
 * Pure-logic coverage for the VS Code theme model. Exercised on the shapes real
 * theme documents actually carry, including the malformed ones a marketplace
 * `.vsix` can produce.
 */
import { describe, expect, it } from "vitest";
import {
  ALL_COLOR_GROUPS,
  applyImport,
  deriveThemeAccents,
  EMPTY_THEME,
  formatFontStyle,
  groupIdOf,
  groupPrefixOf,
  humanizeKey,
  importCount,
  importGroupsOf,
  isHexColor,
  isPickedColorChange,
  NO_FONT_STYLE,
  normalizePickedColor,
  parseFontStyle,
  parseVsCodeTheme,
  searchTheme,
  searchUnsetKeys,
  SEMANTIC_GROUP_ID,
  selectionOf,
  summarizeColorGroups,
  toggleGroup,
  togglePath,
  TOKENS_GROUP_ID,
  toOpaqueHex,
  toThemeDocument,
  type VsCodeTheme,
} from "./vscodeTheme";

const theme = (over: Partial<VsCodeTheme>): VsCodeTheme => ({ ...EMPTY_THEME, ...over });

describe("parseVsCodeTheme", () => {
  it("reads the document VS Code and Shiki agree on", () => {
    const parsed = parseVsCodeTheme(
      {
        name: "Dracula",
        type: "dark",
        semanticHighlighting: true,
        colors: { "editor.background": "#282A36" },
        semanticTokenColors: { "variable.readonly": "#BD93F9" },
        tokenColors: [{ scope: ["comment"], settings: { foreground: "#6272A4", fontStyle: "italic" } }],
      },
      "fallback",
    );
    expect(parsed?.name).toBe("Dracula");
    expect(parsed?.type).toBe("dark");
    expect(parsed?.semanticHighlighting).toBe(true);
    expect(parsed?.colors["editor.background"]).toBe("#282A36");
    expect(parsed?.semanticTokenColors["variable.readonly"]).toBe("#BD93F9");
    expect(parsed?.tokenColors[0]).toEqual({ scope: ["comment"], foreground: "#6272A4", fontStyle: "italic" });
  });

  it("takes the fallback name when the document has none", () => {
    expect(parseVsCodeTheme({ colors: {} }, "monokai.json")?.name).toBe("monokai.json");
  });

  it("normalises a bare-string scope and a comma-separated one", () => {
    const parsed = parseVsCodeTheme(
      { tokenColors: [{ scope: "keyword", settings: {} }, { scope: "a, b ,c", settings: { foreground: "#FFF" } }] },
      "x",
    );
    expect(parsed?.tokenColors[0]?.scope).toEqual(["keyword"]);
    expect(parsed?.tokenColors[1]?.scope).toEqual(["a", "b", "c"]);
  });

  it("falls back to the older `settings` list when `tokenColors` is absent", () => {
    const parsed = parseVsCodeTheme({ settings: [{ scope: ["string"], settings: { foreground: "#F1FA8C" } }] }, "x");
    expect(parsed?.tokenColors).toHaveLength(1);
    expect(parsed?.tokenColors[0]?.foreground).toBe("#F1FA8C");
  });

  it("treats hc variants and unknown types as dark, and only `light` as light", () => {
    expect(parseVsCodeTheme({ type: "light" }, "x")?.type).toBe("light");
    expect(parseVsCodeTheme({ type: "hc-black" }, "x")?.type).toBe("dark");
    expect(parseVsCodeTheme({ type: "hcLight" }, "x")?.type).toBe("light");
    expect(parseVsCodeTheme({}, "x")?.type).toBe("dark");
  });

  it("drops colour values that are not hex", () => {
    const parsed = parseVsCodeTheme({ colors: { a: "#FFFFFF", b: "red", c: 7, d: "#GGG" } }, "x");
    expect(Object.keys(parsed?.colors ?? {})).toEqual(["a"]);
  });

  it("drops a rule that would paint nothing", () => {
    const parsed = parseVsCodeTheme({ tokenColors: [{ scope: [], settings: {} }, "junk", null] }, "x");
    expect(parsed?.tokenColors).toEqual([]);
  });

  it("returns undefined only when the document is not an object", () => {
    expect(parseVsCodeTheme("nope", "x")).toBeUndefined();
    expect(parseVsCodeTheme(null, "x")).toBeUndefined();
    expect(parseVsCodeTheme({}, "x")).toBeDefined();
  });
});

describe("toThemeDocument", () => {
  it("round-trips through the parser unchanged", () => {
    const original = theme({
      name: "Brass",
      type: "light",
      colors: { "editor.background": "#FFFFFF" },
      tokenColors: [{ scope: ["comment"], foreground: "#888888", fontStyle: "italic" }],
      semanticHighlighting: true,
      semanticTokenColors: { "variable.readonly": "#112233" },
    });
    expect(parseVsCodeTheme(toThemeDocument(original), "x")).toEqual(original);
  });

  it("omits an unset foreground or fontStyle rather than writing empty strings", () => {
    const doc = toThemeDocument(theme({ tokenColors: [{ scope: ["x"], foreground: undefined, fontStyle: undefined }] }));
    const rules = doc.tokenColors;
    expect(Array.isArray(rules)).toBe(true);
    expect(JSON.stringify(rules)).toBe('[{"scope":["x"],"settings":{}}]');
  });
});

describe("toOpaqueHex", () => {
  it("passes through a six-digit hex, upper-cased", () => {
    expect(toOpaqueHex("#1a2b3c")).toBe("#1A2B3C");
  });

  it("drops the alpha of an eight-digit hex", () => {
    expect(toOpaqueHex("#12345678")).toBe("#123456");
  });

  it("expands short form and drops its alpha", () => {
    expect(toOpaqueHex("#abc")).toBe("#AABBCC");
    expect(toOpaqueHex("#abcd")).toBe("#AABBCC");
  });

  it("rejects non-hex and undefined", () => {
    expect(toOpaqueHex("rebeccapurple")).toBeUndefined();
    expect(toOpaqueHex(undefined)).toBeUndefined();
  });
});

describe("deriveThemeAccents", () => {
  const fallback = { primary: "#111111", secondary: "#222222" };

  it("keeps the fallback when the theme sets no accent keys", () => {
    expect(deriveThemeAccents(theme({ colors: { "editor.background": "#000000" } }), fallback)).toEqual(fallback);
  });

  it("prefers the button background for primary and focusBorder for secondary, opaque", () => {
    const accents = deriveThemeAccents(theme({ colors: { "button.background": "#ff8800cc", "focusBorder": "#00ccff" } }), fallback);
    expect(accents).toEqual({ primary: "#FF8800", secondary: "#00CCFF" });
  });

  it("falls back only for the role a theme leaves unset", () => {
    const accents = deriveThemeAccents(theme({ colors: { "progressBar.background": "#00ccff" } }), fallback);
    // progressBar.background is only in the secondary list, so primary keeps the fallback.
    expect(accents).toEqual({ primary: "#111111", secondary: "#00CCFF" });
  });
});

describe("isHexColor", () => {
  it("accepts every colour form VS Code writes", () => {
    expect(isHexColor("#FFF")).toBe(true);
    expect(isHexColor("#FFFF")).toBe(true);
    expect(isHexColor("#282A36")).toBe(true);
    expect(isHexColor("#44475A80")).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isHexColor("282A36")).toBe(false);
    expect(isHexColor("#12345")).toBe(false);
    expect(isHexColor("rgb(1,2,3)")).toBe(false);
    expect(isHexColor("")).toBe(false);
  });
});

describe("humanizeKey", () => {
  it("reads a key as a capitalised sentence", () => {
    expect(humanizeKey("editor.background")).toBe("Editor background");
    expect(humanizeKey("editor.selectionHighlightBackground")).toBe("Editor selection highlight background");
    expect(humanizeKey("gitDecoration.addedResourceForeground")).toBe("Git decoration added resource foreground");
  });

  it("strips the group prefix when one is given", () => {
    expect(humanizeKey("editor.background", "editor")).toBe("Background");
    expect(humanizeKey("editor.lineNumber.foreground", "editor")).toBe("Line number foreground");
  });

  it("leaves the key alone when the prefix does not apply", () => {
    expect(humanizeKey("focusBorder", "editor")).toBe("Focus border");
  });

  it("spells acronyms the way they are written", () => {
    expect(humanizeKey("terminal.ansiBrightBlack")).toBe("Terminal ANSI bright black");
    expect(humanizeKey("textLink.foreground")).toBe("Text link foreground");
  });

  it("handles a single-segment key and an empty one", () => {
    expect(humanizeKey("foreground")).toBe("Foreground");
    expect(humanizeKey("")).toBe("");
  });
});

describe("groupIdOf", () => {
  it("routes keys to the group someone would look in", () => {
    expect(groupIdOf("editor.background")).toBe("editor");
    expect(groupIdOf("editorGutter.modifiedBackground")).toBe("editor");
    expect(groupIdOf("sideBar.background")).toBe("sidebar");
    expect(groupIdOf("terminal.ansiRed")).toBe("terminal");
    expect(groupIdOf("gitDecoration.addedResourceForeground")).toBe("git");
  });

  it("gives editorGroupHeader to Tabs, not Editor — longest prefix wins", () => {
    expect(groupIdOf("editorGroupHeader.tabsBackground")).toBe("tabs");
    expect(groupIdOf("editorGroup.border")).toBe("tabs");
  });

  it("matches on a dot boundary, never a partial word", () => {
    // `tab` must not swallow `tabSomethingElse`.
    expect(groupIdOf("tab.activeBackground")).toBe("tabs");
    expect(groupIdOf("tabulator.background")).toBe("other");
  });

  it("sends unclaimed keys to Everything else", () => {
    expect(groupIdOf("focusBorder")).toBe("other");
    expect(groupIdOf("someVendor.thing")).toBe("other");
  });

  it("only ever names a group that exists", () => {
    const ids = new Set(ALL_COLOR_GROUPS.map((group) => group.id));
    for (const key of ["editor.background", "tab.border", "zzz.unknown", "foreground"]) {
      expect(ids.has(groupIdOf(key))).toBe(true);
    }
  });
});

describe("groupPrefixOf", () => {
  it("is the dotted head, or nothing for a bare key", () => {
    expect(groupPrefixOf("editor.background")).toBe("editor");
    expect(groupPrefixOf("focusBorder")).toBeUndefined();
  });
});

describe("summarizeColorGroups", () => {
  const colors = {
    "editor.background": "#282A36",
    "editor.foreground": "#F8F8F2",
    "tab.border": "#44475A",
    focusBorder: "#BD93F9",
  };

  it("lists only groups with something set, in table order", () => {
    expect(summarizeColorGroups(colors).map((s) => s.group.id)).toEqual(["editor", "tabs", "other"]);
  });

  it("sorts keys and takes the first as the swatch", () => {
    const editor = summarizeColorGroups(colors)[0];
    expect(editor?.keys).toEqual(["editor.background", "editor.foreground"]);
    expect(editor?.sample).toBe("#282A36");
  });

  it("is empty for a theme with no colours", () => {
    expect(summarizeColorGroups({})).toEqual([]);
  });
});

describe("searchTheme", () => {
  const subject = theme({
    colors: {
      "editor.background": "#282A36",
      "editor.lineNumber.foreground": "#6272A4",
      focusBorder: "#BD93F9",
    },
    tokenColors: [
      { scope: ["comment"], foreground: "#6272A4", fontStyle: "italic" },
      { scope: ["keyword", "storage.type"], foreground: "#FF79C6", fontStyle: undefined },
    ],
  });

  it("matches the raw key", () => {
    expect(searchTheme(subject, "focusBorder").colors.map((c) => c.key)).toEqual(["focusBorder"]);
  });

  it("matches the humanised label, which is the point of having one", () => {
    expect(searchTheme(subject, "line number").colors.map((c) => c.key)).toEqual(["editor.lineNumber.foreground"]);
  });

  it("matches the value", () => {
    expect(searchTheme(subject, "#282A36").colors.map((c) => c.key)).toEqual(["editor.background"]);
  });

  it("matches token scopes and reports which scope hit", () => {
    const hits = searchTheme(subject, "storage").tokens;
    expect(hits).toHaveLength(1);
    expect(hits[0]?.index).toBe(1);
    expect(hits[0]?.scope).toBe("storage.type");
  });

  it("is case-insensitive and ignores surrounding space", () => {
    expect(searchTheme(subject, "  FOCUSBORDER ").colors).toHaveLength(1);
  });

  it("returns nothing for an empty query rather than everything", () => {
    expect(searchTheme(subject, "")).toEqual({ colors: [], tokens: [] });
    expect(searchTheme(subject, "   ")).toEqual({ colors: [], tokens: [] });
  });
});

describe("normalizePickedColor", () => {
  // `@expo/ui` formats with `#%02X%02X%02X%02X` when `supportsOpacity` is on,
  // so everything the picker reports arrives as eight uppercase digits.
  it("drops a fully opaque alpha when the key had none", () => {
    expect(normalizePickedColor("#1E1E1EFF", "#1e1e1e")).toBe("#1e1e1e");
  });

  it("keeps the alpha when the key already carried one", () => {
    expect(normalizePickedColor("#1E1E1EFF", "#1e1e1e80")).toBe("#1e1e1eff");
  });

  it("keeps a real alpha whatever the key looked like", () => {
    expect(normalizePickedColor("#1E1E1E80", "#1e1e1e")).toBe("#1e1e1e80");
  });

  it("follows the case the key was written in", () => {
    expect(normalizePickedColor("#AABBCCFF", "#AABBCC")).toBe("#AABBCC");
    expect(normalizePickedColor("#AABBCCFF", "#aabbcc")).toBe("#aabbcc");
  });

  it("writes a key with no previous value in lower case", () => {
    expect(normalizePickedColor("#AABBCCFF", undefined)).toBe("#aabbcc");
  });

  it("reads a short previous value for whether it had an alpha", () => {
    expect(normalizePickedColor("#AABBCCFF", "#abc")).toBe("#aabbcc");
    expect(normalizePickedColor("#AABBCCFF", "#abcd")).toBe("#aabbccff");
  });
});

describe("isPickedColorChange", () => {
  it("rejects the same colour reported in the picker's own notation", () => {
    expect(isPickedColorChange("#1E1E1EFF", "#1e1e1e")).toBe(false);
  });

  it("accepts a colour that differs", () => {
    expect(isPickedColorChange("#2E2E2EFF", "#1e1e1e")).toBe(true);
  });

  it("accepts any colour for a key with no previous value", () => {
    expect(isPickedColorChange("#1E1E1EFF", undefined)).toBe(true);
  });

  it("spots an alpha change on a key that already had one", () => {
    expect(isPickedColorChange("#1E1E1E80", "#1e1e1eff")).toBe(true);
  });

  it("rejects anything that is not a colour", () => {
    expect(isPickedColorChange("rebeccapurple", "#1e1e1e")).toBe(false);
    expect(isPickedColorChange("", undefined)).toBe(false);
  });
});

describe("searchUnsetKeys", () => {
  const subject: VsCodeTheme = { ...EMPTY_THEME, colors: { "editor.background": "#1e1e1e" } };

  it("finds a key the theme has never set", () => {
    expect(searchUnsetKeys(subject, "terminal.ansiRed", 20).map((h) => h.key)).toContain("terminal.ansiRed");
  });

  it("never offers a key the theme already sets", () => {
    expect(searchUnsetKeys(subject, "editor.background", 20).map((h) => h.key)).not.toContain("editor.background");
  });

  it("matches the humanised label as well as the key", () => {
    expect(searchUnsetKeys(subject, "line number", 20).map((h) => h.key)).toContain("editorLineNumber.foreground");
  });

  it("carries the label the row renders", () => {
    const hit = searchUnsetKeys(subject, "terminal.ansiRed", 20)[0];
    expect(hit?.label).toBe(humanizeKey("terminal.ansiRed"));
  });

  it("stops at the limit", () => {
    expect(searchUnsetKeys(subject, "editor", 5)).toHaveLength(5);
  });

  it("returns nothing for an empty query rather than the whole catalog", () => {
    expect(searchUnsetKeys(subject, "", 20)).toEqual([]);
    expect(searchUnsetKeys(subject, "   ", 20)).toEqual([]);
  });
});

describe("font styles", () => {
  it("parses the space-separated form in any order", () => {
    expect(parseFontStyle("italic bold")).toEqual({ bold: true, italic: true, underline: false, strikethrough: false });
    expect(parseFontStyle("underline")).toEqual({ bold: false, italic: false, underline: true, strikethrough: false });
  });

  it("treats absent and empty as nothing set", () => {
    expect(parseFontStyle(undefined)).toEqual(NO_FONT_STYLE);
    expect(parseFontStyle("")).toEqual(NO_FONT_STYLE);
  });

  it("writes the flags back in a stable order", () => {
    expect(formatFontStyle({ bold: true, italic: true, underline: false, strikethrough: false })).toBe("bold italic");
  });

  it("omits the field rather than writing an empty string, which means something else", () => {
    expect(formatFontStyle(NO_FONT_STYLE)).toBeUndefined();
  });

  it("round-trips", () => {
    for (const value of ["bold", "italic", "bold italic underline", "strikethrough"]) {
      expect(formatFontStyle(parseFontStyle(value))).toBe(value);
    }
  });
});

describe("importGroupsOf", () => {
  const source = theme({
    colors: { "editor.background": "#272822", "tab.border": "#75715E" },
    tokenColors: [{ scope: ["comment"], foreground: "#75715E", fontStyle: "italic" }],
    semanticTokenColors: { "variable.readonly": "#AE81FF" },
  });

  it("offers colours, token rules and semantic tokens through one path scheme", () => {
    const paths = importGroupsOf(source).flatMap((group) => group.items.map((item) => item.path));
    expect(paths).toEqual(["colors:editor.background", "colors:tab.border", "tokens:0", "semantic:variable.readonly"]);
  });

  it("labels a token rule by its first scope", () => {
    const tokens = importGroupsOf(source).find((group) => group.id === TOKENS_GROUP_ID);
    expect(tokens?.items[0]?.label).toBe("comment");
  });

  it("omits empty sections", () => {
    const groups = importGroupsOf(theme({ colors: { focusBorder: "#FFF" } }));
    expect(groups.map((g) => g.id)).toEqual(["other"]);
    expect(groups.some((g) => g.id === SEMANTIC_GROUP_ID)).toBe(false);
  });
});

describe("selection", () => {
  const paths = ["a", "b", "c"];

  it("is tri-state, because a parent whose children disagree has no binary answer", () => {
    expect(selectionOf(paths, new Set())).toBe("none");
    expect(selectionOf(paths, new Set(["a"]))).toBe("some");
    expect(selectionOf(paths, new Set(paths))).toBe("all");
  });

  it("treats an empty group as none", () => {
    expect(selectionOf([], new Set(["a"]))).toBe("none");
  });

  it("selects a whole group, and clears it once full", () => {
    const filled = toggleGroup(paths, new Set());
    expect(selectionOf(paths, filled)).toBe("all");
    expect(selectionOf(paths, toggleGroup(paths, filled))).toBe("none");
  });

  it("completes a partial group rather than clearing it", () => {
    expect(selectionOf(paths, toggleGroup(paths, new Set(["a"])))).toBe("all");
  });

  it("leaves paths outside the group alone", () => {
    expect(toggleGroup(paths, new Set(["z"])).has("z")).toBe(true);
  });

  it("toggles one path both ways", () => {
    expect(togglePath("a", new Set()).has("a")).toBe(true);
    expect(togglePath("a", new Set(["a"])).has("a")).toBe(false);
  });
});

describe("applyImport", () => {
  const target = theme({
    name: "Brass",
    type: "dark",
    colors: { "editor.background": "#282A36", "editor.foreground": "#F8F8F2" },
    tokenColors: [{ scope: ["comment"], foreground: "#6272A4", fontStyle: undefined }],
    semanticHighlighting: true,
  });
  const source = theme({
    name: "Monokai",
    type: "light",
    colors: { "editor.background": "#272822", "tab.border": "#75715E" },
    tokenColors: [{ scope: ["keyword"], foreground: "#F92672", fontStyle: "bold" }],
    semanticTokenColors: { "variable.readonly": "#AE81FF" },
  });

  it("overwrites only what was selected", () => {
    const merged = applyImport(target, source, new Set(["colors:editor.background"]));
    expect(merged.colors["editor.background"]).toBe("#272822");
    expect(merged.colors["editor.foreground"]).toBe("#F8F8F2");
    expect(merged.colors["tab.border"]).toBeUndefined();
  });

  it("adds a key the target did not have", () => {
    expect(applyImport(target, source, new Set(["colors:tab.border"])).colors["tab.border"]).toBe("#75715E");
  });

  it("appends a token rule, because later rules win in VS Code", () => {
    const merged = applyImport(target, source, new Set(["tokens:0"]));
    expect(merged.tokenColors).toHaveLength(2);
    expect(merged.tokenColors[1]?.scope).toEqual(["keyword"]);
  });

  it("imports semantic tokens", () => {
    expect(applyImport(target, source, new Set(["semantic:variable.readonly"])).semanticTokenColors["variable.readonly"]).toBe(
      "#AE81FF",
    );
  });

  it("never imports identity — name and type belong to the theme being edited", () => {
    const merged = applyImport(target, source, new Set(["colors:editor.background", "tokens:0"]));
    expect(merged.name).toBe("Brass");
    expect(merged.type).toBe("dark");
    expect(merged.semanticHighlighting).toBe(true);
  });

  it("ignores paths the source cannot satisfy rather than writing undefined", () => {
    const merged = applyImport(target, source, new Set(["colors:nope", "tokens:99", "tokens:x", "semantic:nope", "garbage"]));
    expect(merged.colors).toEqual(target.colors);
    expect(merged.tokenColors).toEqual(target.tokenColors);
    expect(merged.semanticTokenColors).toEqual(target.semanticTokenColors);
  });

  it("leaves the target untouched when nothing is selected", () => {
    expect(applyImport(target, source, new Set())).toEqual(target);
  });

  it("does not mutate either argument", () => {
    const before = JSON.stringify(target);
    applyImport(target, source, new Set(["colors:tab.border", "tokens:0"]));
    expect(JSON.stringify(target)).toBe(before);
  });
});

describe("importCount", () => {
  it("counts what the button will write", () => {
    expect(importCount(new Set())).toBe(0);
    expect(importCount(new Set(["a", "b"]))).toBe(2);
  });
});
