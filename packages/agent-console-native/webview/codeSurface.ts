/**
 * The code surface: Monaco, running inside the app's WebView, themed by Shiki.
 *
 * This file is not part of the React Native bundle. `scripts/gen-code-surface.mjs`
 * bundles it with esbuild for a browser target and inlines the result into
 * `assets/code-surface.html`, which the app loads from its own bundle. Nothing
 * here is fetched at runtime, so the surface renders with no network.
 *
 * Why Monaco and why Shiki together: the app already tokenizes chat code blocks
 * on device with Shiki, and `@shikijs/monaco` hands Monaco the same TextMate
 * grammars and the same VS Code theme. A file and a chat block in the same
 * language and theme therefore resolve the same tokens to the same colours.
 * Monaco's own Monarch grammars are never registered, because a second
 * highlighting source is exactly what the decision this implements rules out.
 *
 * The whole editor is bundled, not its API alone. `editor.main.js` carries
 * Monaco's feature modules with it: find and replace, auto-indent, bracket
 * matching, the comment shortcut, multiple cursors. The endgame for this
 * surface is an editor, so it is built on the full thing from the start rather
 * than on a lean core that every later phase would have to re-add a piece of.
 *
 * Read-only is a mode, not a build. The editor is constructed the way an
 * editable one is and `setReadOnly` flips it, so editing, language
 * intelligence, inline completions and collaborative editing all land on this
 * same instance.
 *
 * @internal
 */
// The runtime bundle, imported for its side effects: evaluating it is what
// registers Monaco's feature modules. Monaco ships type declarations only on
// `editor.api.js`, so the typed namespace comes from there. Both resolve to the
// same module graph, so nothing is bundled twice.
import "monaco-editor/editor/editor.main.js";
import * as monaco from "monaco-editor/editor/editor.api.js";
import { shikiToMonaco } from "@shikijs/monaco";
import { createHighlighterCore, type HighlighterCore, type ThemeRegistrationRaw } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
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
import {
  evictionsFor,
  monacoThemeName,
  parseHostMessage,
  SURFACE_GLOBAL,
  SURFACE_LANGUAGES,
  type SurfaceMessage,
  type SurfaceTheme,
} from "../src/codeSurfaceProtocol";

/**
 * The same eleven grammars `shikiHighlighter.ts` bundles, in the same order.
 * They are duplicated into this bundle rather than sent across the bridge
 * because a TextMate grammar is megabytes of JSON and the surface needs them
 * before it can render a first frame.
 */
const GRAMMARS = [bash, css, go, html, javascript, json, markdown, python, rust, tsx, typescript];

/** The fallbacks, so the surface renders before a theme arrives. */
const BUNDLED_THEMES = [githubDark, githubLight];
const BUNDLED_THEME_NAMES = new Set(["github-dark", "github-light"]);

const post = (message: SurfaceMessage): void => {
  window.ReactNativeWebView?.postMessage(JSON.stringify(message));
};

const messageOf = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

/** Keyed by theme name, because registering one twice throws in Monaco. */
const registeredThemes = new Set<string>();

let highlighter: HighlighterCore | undefined;
let editor: monaco.editor.IStandaloneCodeEditor | undefined;
let readOnly = true;

/**
 * One file the surface is holding: its model, what it cost, when it was last
 * displayed, and the scroll and cursor it was left at.
 */
interface Document {
  readonly model: monaco.editor.ITextModel;
  readonly bytes: number;
  version: number;
  shownAt: number;
  viewState: monaco.editor.ICodeEditorViewState | null;
}

const documents = new Map<string, Document>();
let visiblePath: string | undefined;

/**
 * A model URI from a file path.
 *
 * Monaco keys models by URI and refuses two with the same one, so the path is
 * the identity. `file` rather than `inmemory` because a later phase hands these
 * to a language server, which expects a file URI.
 */
const uriOf = (path: string): monaco.Uri => monaco.Uri.from({ scheme: "file", path });

/**
 * The id this theme is registered and selected by, which is not always the name
 * it arrived with: Monaco refuses anything outside `[a-z0-9-]`, and an
 * installed theme arrives named by the file it was read from.
 */
const themeIdOf = (theme: string | SurfaceTheme): string =>
  monacoThemeName(typeof theme === "string" ? theme : theme.name);

/**
 * Hand Monaco every grammar and every theme Shiki currently holds.
 *
 * `shikiToMonaco` rewires the tokenizer for each registered language, so it is
 * called again after a theme is loaded rather than once at startup. Monaco
 * keeps one tokenizer per language, so repeating this replaces rather than
 * stacks.
 */
const applyShiki = (hl: HighlighterCore): void => {
  shikiToMonaco(hl, monaco);
};

const ensureHighlighter = async (): Promise<HighlighterCore> => {
  if (highlighter === undefined) {
    highlighter = await createHighlighterCore({
      themes: BUNDLED_THEMES,
      langs: GRAMMARS,
      engine: createJavaScriptRegexEngine(),
    });
    for (const name of BUNDLED_THEME_NAMES) registeredThemes.add(name);
    applyShiki(highlighter);
  }
  return highlighter;
};

/**
 * The theme in the shape Shiki's loader insists on.
 *
 * Shiki moves `tokenColors` into `settings` only when `settings` is absent, and
 * a VS Code theme document carries the former and not the latter. Handing over
 * an empty `settings` would satisfy the type and then silently lose every token
 * rule, because an empty array is not absent. The same rule is applied here,
 * where it is visible.
 */
const toShikiTheme = (theme: SurfaceTheme): ThemeRegistrationRaw => ({
  ...theme,
  name: theme.name,
  settings: theme.settings ?? theme.tokenColors ?? [],
});

const setTheme = async (theme: string | SurfaceTheme): Promise<void> => {
  const hl = await ensureHighlighter();
  const id = themeIdOf(theme);
  if (typeof theme !== "string" && !registeredThemes.has(id)) {
    // Registered under the Monaco-safe id, because `shikiToMonaco` hands Monaco
    // whatever name Shiki holds the theme under.
    await hl.loadTheme(toShikiTheme({ ...theme, name: id }));
    registeredThemes.add(id);
    // A newly loaded theme needs Monaco's theme data generated for it, which is
    // what re-running the bridge does.
    applyShiki(hl);
  }
  monaco.editor.setTheme(id);
  // The page behind the editor has to match, or a short document shows the
  // browser's default white below the last line.
  const background = typeof theme === "string" ? undefined : theme.colors?.["editor.background"];
  if (background !== undefined) document.body.style.backgroundColor = background;
};

/** Remember where the visible file was left, before showing another. */
const rememberViewState = (): void => {
  if (visiblePath === undefined) return;
  const held = documents.get(visiblePath);
  if (held !== undefined && editor !== undefined) held.viewState = editor.saveViewState();
};

const showDocument = (path: string): void => {
  const held = documents.get(path);
  if (held === undefined || editor === undefined) return;
  if (visiblePath !== path) rememberViewState();
  visiblePath = path;
  held.shownAt = Date.now();
  editor.setModel(held.model);
  // Restoring puts the scroll, the cursor and the folded regions back, which is
  // the whole point of keeping the file rather than re-reading it.
  if (held.viewState !== null) editor.restoreViewState(held.viewState);
  reportHeight();
};

/**
 * Let go of the files the budget cannot cover, oldest first.
 *
 * Monaco does not free a model when it stops being displayed, so this is the
 * only thing that reclaims one. Each is reported, because the host tracks what
 * the surface holds and would otherwise ask to show something that is gone.
 */
const evict = (): void => {
  const held = [...documents].map(([path, entry]) => ({ path, bytes: entry.bytes, shownAt: entry.shownAt }));
  for (const path of evictionsFor(held, visiblePath)) {
    documents.get(path)?.model.dispose();
    documents.delete(path);
    post({ kind: "documentEvicted", path });
  }
};

const openDocument = (path: string, text: string, language: string, version: number): void => {
  const existing = documents.get(path);
  if (existing !== undefined) {
    // A stale open, from the host replaying its state after a reload.
    if (version < existing.version) return;
    existing.version = version;
    if (existing.model.getValue() !== text) existing.model.setValue(text);
    monaco.editor.setModelLanguage(existing.model, language);
    showDocument(path);
    return;
  }
  documents.set(path, {
    model: monaco.editor.createModel(text, language, uriOf(path)),
    bytes: text.length,
    version,
    shownAt: Date.now(),
    viewState: null,
  });
  showDocument(path);
  evict();
};

const closeDocument = (path: string): void => {
  const held = documents.get(path);
  if (held === undefined) return;
  held.model.dispose();
  documents.delete(path);
  if (visiblePath === path) visiblePath = undefined;
};

/** Memory pressure: keep the file being looked at, drop the rest. */
const closeAllExcept = (path: string): void => {
  for (const held of [...documents.keys()]) {
    if (held !== path) closeDocument(held);
  }
};

/**
 * A `@font-face` for a font the device does not have, injected once per family.
 * Nothing calls this yet: a custom code font needs `expo-font` before the rest
 * of the app can render it, and this surface must match the chat blocks rather
 * than get ahead of them. The path exists so that when the font lands, the
 * surface needs no protocol change.
 */
const injectedFonts = new Set<string>();

const injectFontFace = (family: string, source: string): void => {
  if (injectedFonts.has(family)) return;
  injectedFonts.add(family);
  const style = document.createElement("style");
  style.textContent = `@font-face{font-family:${JSON.stringify(family)};src:url(${JSON.stringify(source)});font-display:block;}`;
  document.head.appendChild(style);
};

const setFont = (family: string, size: number, source: string | undefined): void => {
  if (source !== undefined) injectFontFace(family, source);
  editor?.updateOptions({ fontFamily: family, fontSize: size, lineHeight: Math.round(size * 1.45) });
  // Monaco caches glyph widths; a font swap has to invalidate that or the
  // gutter and the text drift apart.
  monaco.editor.remeasureFonts();
  reportHeight();
};

const scrollTo = (line: number): void => {
  editor?.revealLineInCenter(Math.max(1, line));
  editor?.setPosition({ lineNumber: Math.max(1, line), column: 1 });
};

/**
 * Read-only also decides who owns selection.
 *
 * Monaco takes selection over itself and marks the editor `no-user-select`,
 * which on a touch device leaves the text unselectable and the system Copy
 * callout with nothing to act on. While the surface is read-only the platform
 * keeps selection, which is what a reader wants; the moment it becomes editable
 * Monaco needs it back, cursor and all.
 */
const setReadOnly = (next: boolean): void => {
  readOnly = next;
  // `domReadOnly` has to move with the mode. On its own `readOnly` refuses the
  // edit after the input has taken it; together they stop it at the DOM.
  editor?.updateOptions({ readOnly: next, domReadOnly: next });
  document.body.classList.toggle("surface-readonly", next);
};

let lastHeight = -1;

const reportHeight = (): void => {
  const height = editor?.getContentHeight() ?? 0;
  if (height === lastHeight) return;
  lastHeight = height;
  post({ kind: "contentHeight", height });
};

const receive = (raw: string): void => {
  void (async (): Promise<void> => {
    try {
      const message = parseHostMessage(raw);
      if (message === undefined) return;
      switch (message.kind) {
        case "openDocument":
          openDocument(message.path, message.text, message.language, message.version);
          return;
        case "showDocument":
          showDocument(message.path);
          return;
        case "closeDocument":
          closeDocument(message.path);
          return;
        case "closeAllExcept":
          closeAllExcept(message.path);
          return;
        case "setTheme":
          await setTheme(message.theme);
          return;
        case "setFont":
          setFont(message.family, message.size, message.source);
          return;
        case "scrollTo":
          scrollTo(message.line);
          return;
        case "setReadOnly":
          setReadOnly(message.readOnly);
          return;
      }
    } catch (cause: unknown) {
      post({ kind: "error", message: messageOf(cause) });
    }
  })();
};

const start = async (): Promise<void> => {
  const hl = await ensureHighlighter();
  for (const language of SURFACE_LANGUAGES) monaco.languages.register({ id: language });
  applyShiki(hl);

  // Set before the editor exists, so the first paint is already selectable.
  document.body.classList.toggle("surface-readonly", readOnly);

  const host = document.getElementById("surface");
  if (host === null) throw new Error("The surface container is missing from the document.");

  editor = monaco.editor.create(host, {
    // No implicit model: every document the surface shows is one it created for
    // a path and is tracking, so an anonymous one here would be a model nothing
    // owns and nothing ever disposes.
    model: null,
    // The mode, not the build. `setReadOnly` moves both of these together.
    readOnly,
    domReadOnly: readOnly,
    automaticLayout: true,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    // The host is a touch device: momentum scrolling is the platform's job and
    // Monaco's own overlay scrollbars only get in its way.
    scrollbar: { vertical: "auto", horizontal: "auto", useShadows: false },
    renderLineHighlight: "none",
    occurrencesHighlight: "off",
    selectionHighlight: false,
    lineNumbersMinChars: 3,
    padding: { top: 8, bottom: 40 },
    fontLigatures: false,
    wordWrap: "off",
  });

  editor.onDidChangeCursorSelection((event) => {
    const model = editor?.getModel();
    post({
      kind: "selectionChanged",
      text: model === null || model === undefined ? "" : model.getValueInRange(event.selection),
      startLine: event.selection.startLineNumber,
      endLine: event.selection.endLineNumber,
    });
  });

  editor.onDidContentSizeChange(reportHeight);

  // Monaco turns a URL in the text into a link and opens it through its own
  // opener, which navigates this page. The host decides what a link means,
  // because only it can open Safari, so the opener is claimed here: returning
  // true is what stops Monaco navigating.
  monaco.editor.registerLinkOpener({
    open: (resource) => {
      post({ kind: "linkActivated", url: resource.toString() });
      return true;
    },
  });

  post({ kind: "ready" });
};

window[SURFACE_GLOBAL] = { receive };

window.addEventListener("error", (event) => post({ kind: "error", message: event.message }));
window.addEventListener("unhandledrejection", (event) =>
  post({ kind: "error", message: messageOf(event.reason) }),
);

void start().catch((cause: unknown) => post({ kind: "error", message: messageOf(cause) }));

declare global {
  interface Window {
    /** Injected by `react-native-webview` into every document it loads. */
    readonly ReactNativeWebView?: { readonly postMessage: (message: string) => void };
    [SURFACE_GLOBAL]: { readonly receive: (raw: string) => void };
  }
}
