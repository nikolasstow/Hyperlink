/**
 * The colours a conflict is drawn in, read from the VS Code theme the way VS
 * Code itself reads them, with VS Code's own defaults where a theme sets none:
 *
 * - your lines / the agent's: `merge.currentContentBackground` /
 *   `merge.incomingContentBackground` (by default, the header colours at 40%);
 * - the Mine / Theirs buttons: `merge.currentHeaderBackground` /
 *   `merge.incomingHeaderBackground` (VS Code puts a conflict's actions on its
 *   header rows); by default `#40C8AE` / `#40A6FF` at 50%, light or dark;
 * - the panel holding them: `editorWidget.background` and
 *   `editorWidget.border`, the colours of VS Code's floating editor widgets;
 * - their labels: `editor.foreground`.
 *
 * @internal
 */

export interface MergeColors {
  readonly currentContent: string;
  readonly incomingContent: string;
  readonly currentHeader: string;
  readonly incomingHeader: string;
  readonly widgetBackground: string;
  readonly widgetBorder: string;
  readonly label: string;
}

/** VS Code's defaults (src/vs/platform/theme/common/colors/editorColors.ts). */
const CURRENT_HEADER = "#40C8AE80";
const INCOMING_HEADER = "#40A6FF80";
/** A merge content colour is its header made this much more transparent. */
const CONTENT_TRANSPARENCY = 0.4;
const WIDGET = {
  dark: {
    background: "#252526",
    border: "#454545",
    foreground: "#BBBBBB",
  },
  light: {
    background: "#F3F3F3",
    border: "#C8C8C8",
    foreground: "#333333",
  },
} as const;

/** `#rgb`, `#rgba`, `#rrggbb` or `#rrggbbaa` with its alpha multiplied by
 * `factor`, as VS Code's `transparent()`; undefined if it isn't a hex colour. */
export const transparent = (hex: string, factor: number): string | undefined => {
  const digits = hex.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]+$/.test(digits)) return undefined;
  const full = digits.length === 3 || digits.length === 4 ? [...digits].map((digit) => digit + digit).join("") : digits;
  if (full.length !== 6 && full.length !== 8) return undefined;
  const alpha = full.length === 8 ? parseInt(full.slice(6), 16) / 255 : 1;
  const scaled = Math.round(alpha * factor * 255)
    .toString(16)
    .padStart(2, "0");
  return `#${full.slice(0, 6)}${scaled}`.toUpperCase();
};

/** A theme's merge colours. `colors` is the theme's `colors`; `light` its type. */
export const mergeColorsOf = (colors: Readonly<Record<string, string>> | undefined, light: boolean): MergeColors => {
  const widget = light ? WIDGET.light : WIDGET.dark;
  const currentHeader = colors?.["merge.currentHeaderBackground"] ?? CURRENT_HEADER;
  const incomingHeader = colors?.["merge.incomingHeaderBackground"] ?? INCOMING_HEADER;
  return {
    currentHeader,
    incomingHeader,
    currentContent: colors?.["merge.currentContentBackground"] ?? transparent(currentHeader, CONTENT_TRANSPARENCY) ?? currentHeader,
    incomingContent: colors?.["merge.incomingContentBackground"] ?? transparent(incomingHeader, CONTENT_TRANSPARENCY) ?? incomingHeader,
    widgetBackground: colors?.["editorWidget.background"] ?? widget.background,
    widgetBorder: colors?.["editorWidget.border"] ?? widget.border,
    label: colors?.["editor.foreground"] ?? widget.foreground,
  };
};
