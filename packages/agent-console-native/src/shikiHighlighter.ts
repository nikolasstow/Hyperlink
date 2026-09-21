/**
 * On-device syntax highlighting with Shiki — the same engine VS Code uses, so
 * it consumes real VS Code themes (their `tokenColors`). Uses Shiki's
 * **JavaScript regex engine**, not the oniguruma WASM one, so it runs under
 * Hermes with no native module.
 *
 * Performance: the highlighter is created ONCE (a lazy singleton) with a curated
 * set of languages bundled; custom themes are loaded on demand and de-duped;
 * callers memoize the token output per (code, lang, theme). `tokenize` is sync
 * once the singleton has resolved.
 *
 * This is the foundation — first surfaced as a preview in Appearance, later the
 * renderer for chat code blocks and the file viewer/editor.
 *
 * @internal
 */
import { createHighlighterCore, type HighlighterCore, type LanguageRegistration, type ThemeRegistrationRaw } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import { cacheKey, getCachedTokens, setCachedTokens } from "./codeCache";
import type { VsCodeTheme } from "./vscodeTheme";
import bash from "shiki/langs/bash.mjs";
import css from "shiki/langs/css.mjs";
import go from "shiki/langs/go.mjs";
import html from "shiki/langs/html.mjs";
import javascript from "shiki/langs/javascript.mjs";
import json from "shiki/langs/json.mjs";
import markdown from "shiki/langs/markdown.mjs";
import python from "shiki/langs/python.mjs";
import rust from "shiki/langs/rust.mjs";
import tsx from "shiki/langs/tsx.mjs";
import typescript from "shiki/langs/typescript.mjs";
import githubDark from "shiki/themes/github-dark.mjs";
import githubLight from "shiki/themes/github-light.mjs";

/** Language id → grammar module. Statically imported (so bundled) but registered
 * with the highlighter only on first use, so we don't compile every grammar up
 * front — grammar compilation is the expensive part, done lazily per language. */
const LANG_MODULES: Record<string, LanguageRegistration[]> = {
  typescript,
  tsx,
  javascript,
  json,
  python,
  bash,
  go,
  rust,
  html,
  css,
  markdown,
};

/** Common aliases → a known language id. */
const LANG_ALIASES: Record<string, string> = {
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "tsx",
  py: "python",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  rs: "rust",
  golang: "go",
  md: "markdown",
  htm: "html",
};

/** Built-in fallback theme names by colour scheme, used when no VS Code theme
 * is supplied. */
export const FALLBACK_THEME = { dark: "github-dark", light: "github-light" } as const;

/**
 * A device-created theme shaped for Shiki, the same way `getThemeJson` shapes a
 * server one — so a created theme can highlight with no server file to fetch.
 * `settings` mirrors `tokenColors` because Shiki reads that name.
 */
export const shikiThemeOf = (theme: VsCodeTheme): ThemeRegistrationRaw => {
  const settings = theme.tokenColors.map((rule) => ({
    scope: [...rule.scope],
    settings: {
      ...(rule.foreground === undefined ? {} : { foreground: rule.foreground }),
      ...(rule.fontStyle === undefined ? {} : { fontStyle: rule.fontStyle }),
    },
  }));
  return {
    name: theme.name,
    type: theme.type,
    colors: { ...theme.colors },
    semanticTokenColors: { ...theme.semanticTokenColors },
    tokenColors: settings,
    settings,
  };
};

/** The language id for a filename, from its extension — passed straight to
 * `tokenizeCode`, which resolves aliases and falls back to plain text for
 * anything unknown or extension-less. */
export const langFromFilename = (name: string): string => {
  const base = name.slice(name.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return "text";
  return base.slice(dot + 1).toLowerCase();
};

let singleton: Promise<HighlighterCore> | undefined;
const loadedThemes = new Set<string>(["github-dark", "github-light"]);
const loadedLangs = new Set<string>();

const getHighlighter = (): Promise<HighlighterCore> => {
  if (singleton === undefined) {
    // No languages up front — themes only, then load grammars on demand.
    singleton = createHighlighterCore({
      themes: [githubDark, githubLight],
      langs: [],
      engine: createJavaScriptRegexEngine(),
    });
  }
  return singleton;
};

/** Register a language grammar on first use, then reuse it. */
const ensureLang = async (hl: HighlighterCore, id: string): Promise<string> => {
  if (id === "text") return "text";
  if (!loadedLangs.has(id)) {
    const grammar = LANG_MODULES[id];
    if (grammar === undefined) return "text";
    await hl.loadLanguage(grammar);
    loadedLangs.add(id);
  }
  return id;
};

/** One styled run of text within a line. */
export interface CodeToken {
  readonly content: string;
  readonly color?: string;
  readonly italic: boolean;
  readonly bold: boolean;
}

export interface HighlightResult {
  readonly lines: ReadonlyArray<ReadonlyArray<CodeToken>>;
  /** Editor background/foreground from the theme, for the block's surface. */
  readonly background?: string;
  readonly foreground?: string;
}

/**
 * Highlight `code`. `theme` is either a bundled theme name (see FALLBACK_THEME)
 * or a raw VS Code theme object (from an installed extension) — loaded and
 * cached by its `name` on first use.
 */
export const tokenizeCode = async (params: {
  readonly code: string;
  readonly lang: string;
  readonly theme: string | ThemeRegistrationRaw;
}): Promise<HighlightResult> => {
  const themeName = typeof params.theme === "string" ? params.theme : (params.theme.name ?? "custom");
  const langId = LANG_ALIASES[params.lang.toLowerCase()] ?? params.lang.toLowerCase();

  const key = cacheKey(params.code, langId, themeName);
  const cached = await getCachedTokens(key);
  if (cached !== undefined) return cached;

  const hl = await getHighlighter();
  if (typeof params.theme !== "string" && !loadedThemes.has(themeName)) {
    await hl.loadTheme({ ...params.theme, name: themeName });
    loadedThemes.add(themeName);
  }

  const lang = await ensureLang(hl, LANG_MODULES[langId] !== undefined ? langId : "text");
  const result = hl.codeToTokens(params.code, { lang, theme: themeName });
  const lines = result.tokens.map((line) =>
    line.map((token) => ({
      content: token.content,
      color: token.color,
      italic: (token.fontStyle ?? 0) % 2 === 1,
      bold: ((token.fontStyle ?? 0) & 2) === 2,
    })),
  );
  const output: HighlightResult = { lines, background: result.bg, foreground: result.fg };
  setCachedTokens(key, output);
  return output;
};
