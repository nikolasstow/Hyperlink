/**
 * The messages that cross between React Native and the code surface running
 * inside the WebView.
 *
 * This module is the one place both sides agree, and it is deliberately free of
 * React Native and of DOM: `src/CodeSurface.tsx` imports it, so does
 * `webview/codeSurface.ts`, and so does the test suite. Anything either side
 * needs to know about the other belongs here rather than in a string literal on
 * one end.
 *
 * @internal
 */
import type { ThemeRegistrationRaw } from "shiki/core";

/**
 * A VS Code theme document, as Shiki reads it, with the name it is addressed
 * by.
 *
 * Shiki's own type is what crosses the bridge, rather than a copy of the fields
 * this file happens to know about: a filtered copy would quietly drop whatever
 * a theme carries that the app has not needed yet. It is partial because a
 * theme document from an extension carries `tokenColors` and no `settings`,
 * which Shiki's raw type insists on. `name` is optional upstream and required
 * here, because both sides look the theme up by it.
 */
export type SurfaceTheme = Partial<ThemeRegistrationRaw> & { readonly name: string };

/** React Native to the surface. */
export type HostMessage =
  /**
   * Put a file in the surface and show it.
   *
   * Each path becomes its own Monaco model, which is what makes switching back
   * to a file keep its undo history, its markers and its scroll position. The
   * alternative, one model rewritten per file, throws all three away every
   * time.
   *
   * `version` lets the surface ignore a stale open, which matters because the
   * host queues everything sent before `ready` arrives and replays it after.
   */
  | {
      readonly kind: "openDocument";
      readonly path: string;
      readonly text: string;
      readonly language: string;
      readonly version: number;
    }
  /**
   * Show a file the surface already holds. This is the fast path and carries no
   * text: the host sends it only for a path it believes is still open, which it
   * knows from having opened it and not seen it evicted.
   */
  | { readonly kind: "showDocument"; readonly path: string }
  | { readonly kind: "closeDocument"; readonly path: string }
  /** Shed everything but one file. Sent when iOS reports memory pressure. */
  | { readonly kind: "closeAllExcept"; readonly path: string }
  /** A bundled theme by name, or a whole theme document to register. */
  | { readonly kind: "setTheme"; readonly theme: string | SurfaceTheme }
  /**
   * The code font. `source` is a `data:` URI for a font the system does not
   * have; without it the family has to be one the device already resolves.
   */
  | {
      readonly kind: "setFont";
      readonly family: string;
      readonly size: number;
      readonly source?: string;
    }
  /** Reveal a line, 1-based, as a file opened from a stack trace would want. */
  | { readonly kind: "scrollTo"; readonly line: number }
  /**
   * Phase 1 is this message carrying `false`. The surface is the same Monaco
   * instance either way, which is the whole reason it is built this way.
   */
  | { readonly kind: "setReadOnly"; readonly readOnly: boolean };

/** The surface to React Native. */
export type SurfaceMessage =
  /** Monaco is constructed and the queue can drain. */
  | { readonly kind: "ready" }
  | {
      readonly kind: "selectionChanged";
      readonly text: string;
      readonly startLine: number;
      readonly endLine: number;
    }
  | { readonly kind: "linkActivated"; readonly url: string }
  /** The document's rendered height, for a host that wants to size to content. */
  | { readonly kind: "contentHeight"; readonly height: number }
  /**
   * A file the surface let go of, so the host stops believing it is held and
   * sends the text again next time rather than a `showDocument` for something
   * that is no longer there.
   */
  | { readonly kind: "documentEvicted"; readonly path: string }
  | { readonly kind: "error"; readonly message: string };

/** The global the injected script calls. Named once, used by both sides. */
export const SURFACE_GLOBAL = "__codeSurface";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/**
 * A message the surface sent, or undefined.
 *
 * Everything arriving from a WebView is a string of unknown provenance, so it
 * is parsed and checked rather than cast. A malformed message is dropped, not
 * thrown: the surface is a rendering detail and must never take the screen down
 * with it.
 */
export const parseSurfaceMessage = (raw: string): SurfaceMessage | undefined => {
  const parsed: unknown = ((): unknown => {
    try {
      return JSON.parse(raw);
    } catch {
      return undefined;
    }
  })();
  if (!isRecord(parsed) || typeof parsed.kind !== "string") return undefined;
  switch (parsed.kind) {
    case "ready":
      return { kind: "ready" };
    case "selectionChanged":
      return typeof parsed.text === "string" &&
        typeof parsed.startLine === "number" &&
        typeof parsed.endLine === "number"
        ? {
            kind: "selectionChanged",
            text: parsed.text,
            startLine: parsed.startLine,
            endLine: parsed.endLine,
          }
        : undefined;
    case "linkActivated":
      return typeof parsed.url === "string" ? { kind: "linkActivated", url: parsed.url } : undefined;
    case "contentHeight":
      return typeof parsed.height === "number" ? { kind: "contentHeight", height: parsed.height } : undefined;
    case "documentEvicted":
      return typeof parsed.path === "string" ? { kind: "documentEvicted", path: parsed.path } : undefined;
    case "error":
      return typeof parsed.message === "string" ? { kind: "error", message: parsed.message } : undefined;
    default:
      return undefined;
  }
};

/**
 * A message the host sent, or undefined.
 *
 * The mirror of {@link parseSurfaceMessage}, and checked for the same reason:
 * the surface receives a string, and a message it cannot make sense of is
 * dropped rather than cast into something it is not.
 */
export const parseHostMessage = (raw: string): HostMessage | undefined => {
  const parsed: unknown = ((): unknown => {
    try {
      return JSON.parse(raw);
    } catch {
      return undefined;
    }
  })();
  if (!isRecord(parsed) || typeof parsed.kind !== "string") return undefined;
  switch (parsed.kind) {
    case "openDocument":
      return typeof parsed.path === "string" &&
        typeof parsed.text === "string" &&
        typeof parsed.language === "string" &&
        typeof parsed.version === "number"
        ? {
            kind: "openDocument",
            path: parsed.path,
            text: parsed.text,
            language: parsed.language,
            version: parsed.version,
          }
        : undefined;
    case "showDocument":
      return typeof parsed.path === "string" ? { kind: "showDocument", path: parsed.path } : undefined;
    case "closeDocument":
      return typeof parsed.path === "string" ? { kind: "closeDocument", path: parsed.path } : undefined;
    case "closeAllExcept":
      return typeof parsed.path === "string" ? { kind: "closeAllExcept", path: parsed.path } : undefined;
    case "setTheme":
      if (typeof parsed.theme === "string") return { kind: "setTheme", theme: parsed.theme };
      return isRecord(parsed.theme) && typeof parsed.theme.name === "string"
        ? { kind: "setTheme", theme: { ...parsed.theme, name: parsed.theme.name } }
        : undefined;
    case "setFont":
      return typeof parsed.family === "string" && typeof parsed.size === "number"
        ? {
            kind: "setFont",
            family: parsed.family,
            size: parsed.size,
            ...(typeof parsed.source === "string" ? { source: parsed.source } : {}),
          }
        : undefined;
    case "scrollTo":
      return typeof parsed.line === "number" ? { kind: "scrollTo", line: parsed.line } : undefined;
    case "setReadOnly":
      return typeof parsed.readOnly === "boolean" ? { kind: "setReadOnly", readOnly: parsed.readOnly } : undefined;
    default:
      return undefined;
  }
};

/**
 * `U+2028` and `U+2029` are legal in a JSON string and were illegal in a
 * JavaScript string literal until ES2019. A source file containing either would
 * otherwise turn an injected script into a syntax error, and a file viewer has
 * to survive whatever is in the file. The two characters are built from their
 * code points so that this file holds neither of them.
 */
const LINE_SEPARATOR = String.fromCharCode(0x2028);
const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029);

const escapeLineSeparators = (value: string): string =>
  value.split(LINE_SEPARATOR).join("\\u2028").split(PARAGRAPH_SEPARATOR).join("\\u2029");

/**
 * One host message as JavaScript to evaluate inside the WebView.
 *
 * The payload is JSON encoded twice on purpose: once to carry the message, and
 * once more to become a JavaScript string literal that no file content can
 * break out of. The trailing `true` is what `injectJavaScript` wants, so
 * iOS does not complain about a non-serialisable result.
 */
export const toInjectedScript = (message: HostMessage): string =>
  `window.${SURFACE_GLOBAL}&&window.${SURFACE_GLOBAL}.receive(${escapeLineSeparators(
    JSON.stringify(JSON.stringify(message)),
  )});true;`;

/** Monaco validates a theme name against exactly this and throws otherwise. */
const MONACO_THEME_NAME = /^[a-z0-9-]+$/i;

/**
 * A short, stable digest of a string, so two names that slug alike stay apart.
 * FNV-1a: a handful of lines, no dependency, and collision-resistant enough for
 * distinguishing a few theme names.
 */
const digestOf = (value: string): string => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
};

/**
 * The name Monaco is allowed to know a theme by.
 *
 * Monaco throws `Illegal theme name!` for anything outside `[a-z0-9-]`, and the
 * names arriving here are whatever a theme calls itself ("Night Owl") or, for a
 * theme installed as an extension, the path of the file it was read from. A
 * name Monaco already accepts is left alone, so the bundled `github-dark` stays
 * itself; anything else is slugged, with a digest of the original appended so
 * two themes cannot slug into one.
 */
export const monacoThemeName = (name: string): string => {
  if (MONACO_THEME_NAME.test(name)) return name;
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "")
    .slice(0, 48)
    .replace(/-+$/, "");
  return `${slug.length === 0 ? "theme" : slug}-${digestOf(name)}`;
};

/**
 * How much the surface keeps before it starts letting files go.
 *
 * Measured rather than guessed. A model nobody has looked at costs about its
 * own text and nothing else; the cost arrives when it is displayed, because
 * that is when tokenization state is built, and it scales with the file: about
 * 0.7 MB for five hundred lines, 1 MB for two thousand, 3.8 MB for ten
 * thousand, on top of Monaco's own 15 MB.
 *
 * So the budget counts bytes of text rather than files. A count cap sits beside
 * it only to stop churn through many tiny files building structures without
 * ever crossing the byte budget.
 */
export const DOCUMENT_BUDGET = { bytes: 4_000_000, count: 12 } as const;

/** One file the surface is holding. */
export interface HeldDocument {
  readonly path: string;
  readonly bytes: number;
  /** When it was last displayed, so the oldest goes first. */
  readonly shownAt: number;
}

/**
 * The files to let go of, oldest first, so what remains is inside the budget.
 *
 * The visible file is never evicted whatever the budget says: dropping the
 * document someone is looking at to satisfy a memory rule trades a real problem
 * for a worse one.
 */
export const evictionsFor = (
  held: ReadonlyArray<HeldDocument>,
  visiblePath: string | undefined,
  budget: { readonly bytes: number; readonly count: number } = DOCUMENT_BUDGET,
): ReadonlyArray<string> => {
  const evictable = held
    .filter((entry) => entry.path !== visiblePath)
    .sort((a, b) => a.shownAt - b.shownAt);
  let bytes = held.reduce((total, entry) => total + entry.bytes, 0);
  let count = held.length;
  const evicted: Array<string> = [];
  for (const entry of evictable) {
    if (bytes <= budget.bytes && count <= budget.count) break;
    evicted.push(entry.path);
    bytes -= entry.bytes;
    count -= 1;
  }
  return evicted;
};

/** The language ids the surface has grammars for. Anything else renders plain. */
export const SURFACE_LANGUAGES: ReadonlyArray<string> = [
  "bash",
  "css",
  "go",
  "html",
  "javascript",
  "json",
  "markdown",
  "python",
  "rust",
  "tsx",
  "typescript",
];

/**
 * Filename extensions and aliases that map onto a bundled grammar.
 *
 * Mirrors `shikiHighlighter.ts`'s alias table, because the two surfaces have to
 * choose the same grammar for the same file or a chat block and the file view
 * of it would disagree.
 */
const LANGUAGE_ALIASES: Readonly<Record<string, string>> = {
  cjs: "javascript",
  cts: "typescript",
  golang: "go",
  htm: "html",
  js: "javascript",
  jsx: "tsx",
  md: "markdown",
  mjs: "javascript",
  mts: "typescript",
  py: "python",
  rs: "rust",
  sh: "bash",
  shell: "bash",
  ts: "typescript",
  zsh: "bash",
};

/**
 * The grammar to tokenize with, or `plaintext` when there is none.
 *
 * `plaintext` rather than `text`: that is the id Monaco ships for an
 * unhighlighted buffer, and using Monaco's own name means no language has to be
 * registered for the fallback.
 */
export const surfaceLanguageOf = (lang: string): string => {
  const lower = lang.toLowerCase();
  const resolved = LANGUAGE_ALIASES[lower] ?? lower;
  return SURFACE_LANGUAGES.includes(resolved) ? resolved : "plaintext";
};
