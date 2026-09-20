/**
 * The VS Code colour-theme format, and the pure logic the theme editor is built
 * on: parsing, grouping, search, import selection, and the label humanising the
 * screens render.
 *
 * A theme is the same document VS Code and Shiki already agree on
 * (`ThemeRegistrationRaw`): a `name`, a `type`, a `colors` map of workbench
 * keys, an ordered `tokenColors` list, and optional semantic tokens. Nothing is
 * invented here. The editor writes the format back out unchanged so an exported
 * theme drops straight into VS Code.
 *
 * Deliberately free of React Native imports. `colors.ts` resolves
 * `PlatformColor` at import time, so pulling it in would make this module
 * unloadable under vitest and take every test below with it.
 *
 * @internal
 */

/** Same narrowing `push.ts` uses for unknown payloads. */
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const stringOf = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);

/* ------------------------------------------------------------------ *
 * The format
 * ------------------------------------------------------------------ */

/**
 * Light or dark. VS Code also writes `hc` variants; both map onto one of these
 * two for rendering, so the editor stores what it can honour rather than a
 * third value nothing reads.
 */
export type ThemeType = "light" | "dark";

/**
 * One `tokenColors` entry. `scope` is stored as a list even when the source
 * document wrote a single string, so every consumer handles one shape.
 */
export interface TokenRule {
  readonly scope: ReadonlyArray<string>;
  readonly foreground: string | undefined;
  /** Space-separated VS Code style string, e.g. `"bold italic"`. */
  readonly fontStyle: string | undefined;
}

export interface VsCodeTheme {
  readonly name: string;
  readonly type: ThemeType;
  readonly colors: Readonly<Record<string, string>>;
  readonly tokenColors: ReadonlyArray<TokenRule>;
  readonly semanticHighlighting: boolean;
  readonly semanticTokenColors: Readonly<Record<string, string>>;
}

export const EMPTY_THEME: VsCodeTheme = {
  name: "",
  type: "dark",
  colors: {},
  tokenColors: [],
  semanticHighlighting: false,
  semanticTokenColors: {},
};

/* ------------------------------------------------------------------ *
 * Parsing
 * ------------------------------------------------------------------ */

/** `#RGB`, `#RGBA`, `#RRGGBB` or `#RRGGBBAA`, which is every colour VS Code accepts. */
export const isHexColor = (value: string): boolean => /^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(value);

/** `hc-black` and `hcDark` are dark; anything else unrecognised follows dark, the app's own default. */
const toThemeType = (value: unknown): ThemeType => (stringOf(value)?.toLowerCase().includes("light") === true ? "light" : "dark");

const toScopes = (value: unknown): ReadonlyArray<string> => {
  const single = stringOf(value);
  // VS Code allows a single scope as a bare string, or as one comma-separated
  // string. Both are normalised so nothing downstream has to know.
  if (single !== undefined) {
    return single
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
  }
  if (!Array.isArray(value)) return [];
  const scopes: Array<string> = [];
  for (const entry of value) {
    const scope = stringOf(entry);
    if (scope !== undefined && scope.trim().length > 0) scopes.push(scope.trim());
  }
  return scopes;
};

const toTokenRule = (value: unknown): TokenRule | undefined => {
  if (!isRecord(value)) return undefined;
  const scope = toScopes(value.scope);
  const settings = isRecord(value.settings) ? value.settings : undefined;
  const foreground = settings === undefined ? undefined : stringOf(settings.foreground);
  const fontStyle = settings === undefined ? undefined : stringOf(settings.fontStyle);
  // A rule with no scope and no settings paints nothing; dropping it keeps the
  // list honest rather than showing a row that cannot be edited into anything.
  if (scope.length === 0 && foreground === undefined && fontStyle === undefined) return undefined;
  return {
    scope,
    foreground,
    fontStyle,
  };
};

const toColorMap = (value: unknown): Record<string, string> => {
  if (!isRecord(value)) return {};
  const colors: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value)) {
    const color = stringOf(raw);
    if (color !== undefined && isHexColor(color)) colors[key] = color;
  }
  return colors;
};

/**
 * Narrows a theme document read off disk or the network. Every field is
 * optional in the wild, so anything unreadable becomes its empty value rather
 * than failing the whole parse: a theme missing `semanticTokenColors` is a
 * normal theme, not a broken one.
 *
 * Returns `undefined` only when the document is not an object at all.
 */
export const parseVsCodeTheme = (value: unknown, fallbackName: string): VsCodeTheme | undefined => {
  if (!isRecord(value)) return undefined;
  const rules: Array<TokenRule> = [];
  // `settings` is the older name for the same list; Shiki reads it as a
  // fallback and so do we.
  const rawRules = Array.isArray(value.tokenColors) ? value.tokenColors : Array.isArray(value.settings) ? value.settings : [];
  for (const entry of rawRules) {
    const rule = toTokenRule(entry);
    if (rule !== undefined) rules.push(rule);
  }
  return {
    name: stringOf(value.name) ?? fallbackName,
    type: toThemeType(value.type),
    colors: toColorMap(value.colors),
    tokenColors: rules,
    semanticHighlighting: value.semanticHighlighting === true,
    semanticTokenColors: toColorMap(value.semanticTokenColors),
  };
};

/** The document written back out, in the shape VS Code and Shiki both read. */
export const toThemeDocument = (theme: VsCodeTheme): Record<string, unknown> => ({
  name: theme.name,
  type: theme.type,
  semanticHighlighting: theme.semanticHighlighting,
  colors: { ...theme.colors },
  semanticTokenColors: { ...theme.semanticTokenColors },
  tokenColors: theme.tokenColors.map((rule) => ({
    scope: [...rule.scope],
    settings: {
      ...(rule.foreground === undefined ? {} : { foreground: rule.foreground }),
      ...(rule.fontStyle === undefined ? {} : { fontStyle: rule.fontStyle }),
    },
  })),
});

/**
 * A hex colour normalised to `#RRGGBB` — alpha dropped and short form expanded —
 * or undefined if it is not a hex colour. The app accents are opaque, so a
 * translucent theme value contributes its colour without its alpha.
 */
export const toOpaqueHex = (value: string | undefined): string | undefined => {
  if (value === undefined || !isHexColor(value)) return undefined;
  const body = value.slice(1);
  const rgb =
    body.length === 3 || body.length === 4
      ? body
          .slice(0, 3)
          .split("")
          .map((c) => `${c}${c}`)
          .join("")
      : body.slice(0, 6);
  return `#${rgb.toUpperCase()}`;
};

/** App accents derived from a theme's workbench colours. The keys are the ones
 * VS Code themes most reliably set to their signature accent, tried in order;
 * a theme that sets none keeps the app defaults passed in. Mirrors the server's
 * own derivation for installed themes so a created theme reads the same way. */
export const deriveThemeAccents = (
  theme: VsCodeTheme,
  fallback: { readonly primary: string; readonly secondary: string },
): { readonly primary: string; readonly secondary: string } => {
  const first = (keys: ReadonlyArray<string>): string | undefined => {
    for (const key of keys) {
      const hex = toOpaqueHex(theme.colors[key]);
      if (hex !== undefined) return hex;
    }
    return undefined;
  };
  const primary = first(["button.background", "activityBarBadge.background", "statusBarItem.remoteBackground", "editorCursor.foreground", "focusBorder", "textLink.foreground"]);
  const secondary = first(["focusBorder", "textLink.foreground", "progressBar.background", "activityBarBadge.background", "button.background"]);
  return {
    primary: primary ?? fallback.primary,
    secondary: secondary ?? fallback.secondary,
  };
};

/* ------------------------------------------------------------------ *
 * Labels
 * ------------------------------------------------------------------ */

/** Words that read wrong in sentence case, mapped to how they are actually written. */
const ACRONYMS: Readonly<Record<string, string>> = {
  ansi: "ANSI",
  url: "URL",
  uri: "URI",
  ui: "UI",
  json: "JSON",
  html: "HTML",
  css: "CSS",
  scm: "SCM",
  git: "Git",
  lhs: "LHS",
  rhs: "RHS",
};

/** `selectionHighlightBackground` → `["selection", "highlight", "background"]`. */
const splitWords = (segment: string): ReadonlyArray<string> =>
  segment
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[\s._-]+/)
    .filter((word) => word.length > 0)
    .map((word) => word.toLowerCase());

/**
 * A theme key as a sentence: `editor.lineNumber.foreground` reads
 * `Line number foreground` under the Editor group, or
 * `Editor line number foreground` on its own.
 *
 * Capitalised, because these are row labels rather than code. The raw key stays
 * available next to the control for anyone who needs to match it against the VS
 * Code reference.
 */
export const humanizeKey = (key: string, strippedPrefix?: string): string => {
  const trimmed =
    strippedPrefix !== undefined && key.startsWith(`${strippedPrefix}.`) ? key.slice(strippedPrefix.length + 1) : key;
  const words = trimmed.split(".").flatMap(splitWords);
  if (words.length === 0) return key;
  const spelled = words.map((word) => ACRONYMS[word] ?? word);
  const [first, ...rest] = spelled;
  if (first === undefined) return key;
  // An acronym is already cased; anything else takes a capital on the first letter only.
  const head = ACRONYMS[words[0] ?? ""] !== undefined ? first : first.charAt(0).toUpperCase() + first.slice(1);
  return [head, ...rest].join(" ");
};

/* ------------------------------------------------------------------ *
 * Groups
 * ------------------------------------------------------------------ */

export interface ColorGroup {
  readonly id: string;
  readonly title: string;
  /** Key prefixes this group claims. Longest match across all groups wins. */
  readonly prefixes: ReadonlyArray<string>;
}

/**
 * How the roughly six hundred workbench keys are presented.
 *
 * VS Code namespaces keys with dots, so nesting on the dot is the obvious move
 * and the wrong one: it puts `editorGutter`, `editorGroupHeader` and
 * `editorHoverWidget` beside `editor` as peers, which is accurate and useless.
 * These groups follow what someone goes looking for, and `other` is a real
 * destination rather than a claim the tail has been organised.
 */
export const COLOR_GROUPS: ReadonlyArray<ColorGroup> = [
  {
    id: "editor",
    title: "Editor",
    prefixes: [
      "editor",
      "editorGutter",
      "editorLineNumber",
      "editorCursor",
      "editorBracketMatch",
      "editorBracketHighlight",
      "editorWhitespace",
      "editorIndentGuide",
      "editorRuler",
      "editorCodeLens",
      "editorLink",
      "editorOverviewRuler",
      "editorInlayHint",
      "editorGhostText",
      "editorStickyScroll",
      "editorError",
      "editorWarning",
      "editorInfo",
      "editorHint",
    ],
  },
  {
    id: "sidebar",
    title: "Side Bar and Activity Bar",
    prefixes: ["sideBar", "sideBarTitle", "sideBarSectionHeader", "activityBar", "activityBarBadge", "activityBarTop"],
  },
  {
    id: "tabs",
    title: "Tabs and Editor Groups",
    prefixes: ["tab", "editorGroup", "editorGroupHeader", "breadcrumb", "breadcrumbPicker"],
  },
  {
    id: "bars",
    title: "Status Bar and Title Bar",
    prefixes: ["statusBar", "statusBarItem", "titleBar", "banner", "commandCenter"],
  },
  { id: "terminal", title: "Terminal", prefixes: ["terminal", "terminalCursor", "terminalCommandDecoration", "terminalOverviewRuler"] },
  {
    id: "controls",
    title: "Buttons, Inputs and Lists",
    prefixes: [
      "button",
      "badge",
      "input",
      "inputOption",
      "inputValidation",
      "dropdown",
      "checkbox",
      "radio",
      "toolbar",
      "keybindingLabel",
      "list",
      "listFilterWidget",
      "tree",
      "quickInput",
      "quickInputList",
      "menu",
      "menubar",
      "scrollbar",
      "scrollbarSlider",
      "progressBar",
      "sash",
    ],
  },
  {
    id: "git",
    title: "Git and Diff",
    prefixes: ["gitDecoration", "diffEditor", "diffEditorGutter", "diffEditorOverview", "merge", "mergeEditor", "peekView", "peekViewEditor", "peekViewResult", "peekViewTitle"],
  },
  {
    id: "panels",
    title: "Panels, Notifications and Debug",
    prefixes: ["panel", "panelTitle", "panelSection", "panelInput", "notification", "notifications", "notificationCenter", "notificationToast", "notificationLink", "debugToolBar", "debugIcon", "debugConsole", "debugExceptionWidget", "debugView", "testing", "notebook", "notebookScrollbarSlider", "notebookStatusErrorIcon", "chat", "inlineChat", "problemsErrorIcon", "problemsWarningIcon", "problemsInfoIcon"],
  },
  {
    id: "widgets",
    title: "Widgets and Overlays",
    prefixes: ["editorWidget", "editorSuggestWidget", "editorHoverWidget", "editorMarkerNavigation", "editorMarkerNavigationError", "editorMarkerNavigationWarning", "editorMarkerNavigationInfo", "widget", "pickerGroup", "settings", "welcomePage", "walkThrough", "window", "extensionButton", "extensionBadge", "extensionIcon"],
  },
];

const OTHER_GROUP: ColorGroup = {
  id: "other",
  title: "Everything Else",
  prefixes: [],
};

/** Every group a key can land in, including the catch-all. */
export const ALL_COLOR_GROUPS: ReadonlyArray<ColorGroup> = [...COLOR_GROUPS, OTHER_GROUP];

/**
 * Which group owns a key. Longest prefix wins, so `editorGroupHeader.tabsBorder`
 * reaches Tabs rather than Editor regardless of how the table is ordered.
 * Matching is on a dot boundary: `editor.background` matches `editor`, while
 * `editorGutter.background` does not.
 */
export const groupIdOf = (key: string): string => {
  const head = key.split(".")[0] ?? key;
  let best: string = OTHER_GROUP.id;
  let bestLength = 0;
  for (const group of COLOR_GROUPS) {
    for (const prefix of group.prefixes) {
      if (prefix === head && prefix.length > bestLength) {
        best = group.id;
        bestLength = prefix.length;
      }
    }
  }
  return best;
};

/** The prefix stripped from a key's label inside its group, when one applies. */
export const groupPrefixOf = (key: string): string | undefined => {
  const head = key.split(".")[0] ?? key;
  return key.startsWith(`${head}.`) ? head : undefined;
};

export interface ColorGroupSummary {
  readonly group: ColorGroup;
  /** Keys this theme sets, sorted. */
  readonly keys: ReadonlyArray<string>;
  /** First set colour in the group, for the row's swatch. */
  readonly sample: string | undefined;
}

/** Groups that have at least one key set, in table order. */
export const summarizeColorGroups = (colors: Readonly<Record<string, string>>): ReadonlyArray<ColorGroupSummary> => {
  const byGroup = new Map<string, Array<string>>();
  for (const key of Object.keys(colors)) {
    const id = groupIdOf(key);
    const bucket = byGroup.get(id);
    if (bucket === undefined) byGroup.set(id, [key]);
    else bucket.push(key);
  }
  const summaries: Array<ColorGroupSummary> = [];
  for (const group of ALL_COLOR_GROUPS) {
    const keys = byGroup.get(group.id);
    if (keys === undefined || keys.length === 0) continue;
    const sorted = [...keys].sort((a, b) => a.localeCompare(b));
    const first = sorted[0];
    summaries.push({
      group,
      keys: sorted,
      sample: first === undefined ? undefined : colors[first],
    });
  }
  return summaries;
};

/* ------------------------------------------------------------------ *
 * Search
 * ------------------------------------------------------------------ */

export interface ColorHit {
  readonly key: string;
  readonly label: string;
  readonly value: string;
}

export interface TokenHit {
  readonly index: number;
  readonly scope: string;
  readonly foreground: string | undefined;
}

export interface ThemeSearchResult {
  readonly colors: ReadonlyArray<ColorHit>;
  readonly tokens: ReadonlyArray<TokenHit>;
}

const EMPTY_SEARCH: ThemeSearchResult = { colors: [], tokens: [] };

/**
 * Matches a query against colour keys, their humanised labels, their values,
 * and token scopes. Searching the label as well as the key is what lets
 * "line number" find `editor.lineNumber.foreground`.
 */
export const searchTheme = (theme: VsCodeTheme, query: string): ThemeSearchResult => {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return EMPTY_SEARCH;

  const colors: Array<ColorHit> = [];
  for (const key of Object.keys(theme.colors).sort((a, b) => a.localeCompare(b))) {
    const value = theme.colors[key];
    if (value === undefined) continue;
    const label = humanizeKey(key);
    const haystack = `${key} ${label} ${value}`.toLowerCase();
    if (haystack.includes(needle)) colors.push({ key, label, value });
  }

  const tokens: Array<TokenHit> = [];
  theme.tokenColors.forEach((rule, index) => {
    const match = rule.scope.find((scope) => scope.toLowerCase().includes(needle));
    if (match === undefined) return;
    tokens.push({
      index,
      scope: match,
      foreground: rule.foreground,
    });
  });

  return { colors, tokens };
};

/* ------------------------------------------------------------------ *
 * Font styles
 * ------------------------------------------------------------------ */

export interface FontStyleFlags {
  readonly bold: boolean;
  readonly italic: boolean;
  readonly underline: boolean;
  readonly strikethrough: boolean;
}

export const NO_FONT_STYLE: FontStyleFlags = {
  bold: false,
  italic: false,
  underline: false,
  strikethrough: false,
};

/** VS Code writes these space-separated in any order, and `""` to clear an inherited style. */
export const parseFontStyle = (value: string | undefined): FontStyleFlags => {
  const parts = (value ?? "").toLowerCase().split(/\s+/);
  return {
    bold: parts.includes("bold"),
    italic: parts.includes("italic"),
    underline: parts.includes("underline"),
    strikethrough: parts.includes("strikethrough"),
  };
};

/**
 * Back to the wire form. Returns `undefined` when nothing is set so the key is
 * omitted from the document rather than written as an empty string, which VS
 * Code reads as "clear the inherited style" and is a different instruction.
 */
export const formatFontStyle = (flags: FontStyleFlags): string | undefined => {
  const parts: Array<string> = [];
  if (flags.bold) parts.push("bold");
  if (flags.italic) parts.push("italic");
  if (flags.underline) parts.push("underline");
  if (flags.strikethrough) parts.push("strikethrough");
  return parts.length === 0 ? undefined : parts.join(" ");
};

/* ------------------------------------------------------------------ *
 * Import
 * ------------------------------------------------------------------ */

/**
 * One importable value, addressed by a path so colours, token rules and
 * semantic tokens all select through the same mechanism.
 *
 * Paths are `colors:<key>`, `tokens:<index>` and `semantic:<key>`.
 */
export interface ImportItem {
  readonly path: string;
  readonly groupId: string;
  readonly label: string;
  /** Colour to show beside the row, when the value is one. */
  readonly swatch: string | undefined;
}

export interface ImportGroup {
  readonly id: string;
  readonly title: string;
  readonly items: ReadonlyArray<ImportItem>;
}

export const TOKENS_GROUP_ID = "tokenColors";
export const SEMANTIC_GROUP_ID = "semanticTokenColors";

/** Everything a source theme offers, grouped the way the tree renders it. */
export const importGroupsOf = (theme: VsCodeTheme): ReadonlyArray<ImportGroup> => {
  const groups: Array<ImportGroup> = [];

  for (const summary of summarizeColorGroups(theme.colors)) {
    groups.push({
      id: summary.group.id,
      title: summary.group.title,
      items: summary.keys.map((key) => ({
        path: `colors:${key}`,
        groupId: summary.group.id,
        label: humanizeKey(key),
        swatch: theme.colors[key],
      })),
    });
  }

  if (theme.tokenColors.length > 0) {
    groups.push({
      id: TOKENS_GROUP_ID,
      title: "Token colors",
      items: theme.tokenColors.map((rule, index) => ({
        path: `tokens:${index}`,
        groupId: TOKENS_GROUP_ID,
        label: rule.scope[0] ?? "(no scope)",
        swatch: rule.foreground,
      })),
    });
  }

  const semanticKeys = Object.keys(theme.semanticTokenColors).sort((a, b) => a.localeCompare(b));
  if (semanticKeys.length > 0) {
    groups.push({
      id: SEMANTIC_GROUP_ID,
      title: "Semantic tokens",
      items: semanticKeys.map((key) => ({
        path: `semantic:${key}`,
        groupId: SEMANTIC_GROUP_ID,
        label: key,
        swatch: theme.semanticTokenColors[key],
      })),
    });
  }

  return groups;
};

export type NodeSelection = "all" | "some" | "none";

/** A group checkbox is tri-state, because a parent whose children disagree has no honest binary answer. */
export const selectionOf = (paths: ReadonlyArray<string>, selected: ReadonlySet<string>): NodeSelection => {
  if (paths.length === 0) return "none";
  let picked = 0;
  for (const path of paths) if (selected.has(path)) picked += 1;
  if (picked === 0) return "none";
  return picked === paths.length ? "all" : "some";
};

/** Tapping a group selects all of it unless it is already fully selected, which clears it. */
export const toggleGroup = (
  paths: ReadonlyArray<string>,
  selected: ReadonlySet<string>,
): ReadonlySet<string> => {
  const next = new Set(selected);
  if (selectionOf(paths, selected) === "all") {
    for (const path of paths) next.delete(path);
  } else {
    for (const path of paths) next.add(path);
  }
  return next;
};

export const togglePath = (path: string, selected: ReadonlySet<string>): ReadonlySet<string> => {
  const next = new Set(selected);
  if (next.has(path)) next.delete(path);
  else next.add(path);
  return next;
};

/**
 * Copies the selected values from `source` onto `target`.
 *
 * Import is a merge, not a load: the draft was prefilled from whatever theme
 * was already on, so only the selected paths move and everything else survives.
 * `name` and `type` are never imported, since they identify the theme being
 * edited rather than describe it.
 *
 * A selected token rule is appended rather than merged by scope. VS Code
 * resolves `tokenColors` in order with later rules winning, so appending is what
 * makes an imported rule take effect.
 */
export const applyImport = (
  target: VsCodeTheme,
  source: VsCodeTheme,
  selected: ReadonlySet<string>,
): VsCodeTheme => {
  const colors: Record<string, string> = { ...target.colors };
  const semanticTokenColors: Record<string, string> = { ...target.semanticTokenColors };
  const tokenColors: Array<TokenRule> = [...target.tokenColors];

  for (const path of selected) {
    const separator = path.indexOf(":");
    if (separator < 0) continue;
    const kind = path.slice(0, separator);
    const id = path.slice(separator + 1);

    if (kind === "colors") {
      const value = source.colors[id];
      if (value !== undefined) colors[id] = value;
      continue;
    }
    if (kind === "semantic") {
      const value = source.semanticTokenColors[id];
      if (value !== undefined) semanticTokenColors[id] = value;
      continue;
    }
    if (kind === "tokens") {
      const index = Number.parseInt(id, 10);
      if (!Number.isInteger(index)) continue;
      const rule = source.tokenColors[index];
      if (rule !== undefined) tokenColors.push(rule);
    }
  }

  return {
    name: target.name,
    type: target.type,
    colors,
    semanticTokenColors,
    tokenColors,
    semanticHighlighting: target.semanticHighlighting,
  };
};

/** How many values an import will actually write, for the button's label. */
export const importCount = (selected: ReadonlySet<string>): number => selected.size;
