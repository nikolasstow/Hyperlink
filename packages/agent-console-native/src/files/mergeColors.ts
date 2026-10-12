/**
 * The colours a conflict is drawn in, read from the VS Code theme the way VS
 * Code itself reads them, with VS Code's own defaults where a theme sets none:
 *
 * - your lines / the agent's: `merge.currentContentBackground` /
 *   `merge.incomingContentBackground` (by default, the header colours at 40%);
 * - the Mine / Theirs buttons: `merge.currentHeaderBackground` /
 *   `merge.incomingHeaderBackground` (VS Code puts a conflict's actions on its
 *   header rows); by default `#40C8AE` / `#40A6FF` at 50%, light or dark;
 * - their labels: black or white, picked by the app's own contrast rule
 *   (`textFor`, theme.tsx) on each button's colour as seen over the editor,
 *   one colour for both, white where the two would differ.
 *
 * The panel holding the buttons is plain glass, untinted; it only follows
 * whether the theme is light or dark (`isLightTheme`).
 *
 * @internal
 */

export interface MergeColors {
  readonly currentContent: string;
  readonly incomingContent: string;
  readonly currentHeader: string;
  readonly incomingHeader: string;
}

/** VS Code's defaults (src/vs/platform/theme/common/colors/editorColors.ts). */
const CURRENT_HEADER = "#40C8AE80";
const INCOMING_HEADER = "#40A6FF80";
/** A merge content colour is its header made this much more transparent. */
const CONTENT_TRANSPARENCY = 0.4;
/** The six or eight hex digits of `#rgb`, `#rgba`, `#rrggbb` or `#rrggbbaa`. */
const hexDigits = (hex: string): string | undefined => {
  const digits = hex.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]+$/.test(digits)) return undefined;
  const full = digits.length === 3 || digits.length === 4 ? [...digits].map((digit) => digit + digit).join("") : digits;
  return full.length === 6 || full.length === 8 ? full : undefined;
};

/** A hex colour with its alpha multiplied by `factor`, as VS Code's
 * `transparent()`; undefined if it isn't a hex colour. */
export const transparent = (hex: string, factor: number): string | undefined => {
  const full = hexDigits(hex);
  if (full === undefined) return undefined;
  const alpha = full.length === 8 ? parseInt(full.slice(6), 16) / 255 : 1;
  const scaled = Math.round(alpha * factor * 255)
    .toString(16)
    .padStart(2, "0");
  return `#${full.slice(0, 6)}${scaled}`.toUpperCase();
};

/**
 * Whether a theme is light: its `type` when it says, else whether its editor
 * background is bright (plenty of themes leave `type` out).
 */
export const isLightTheme = (type: string | undefined, background: string | undefined): boolean => {
  if (type === "light") return true;
  if (type === "dark") return false;
  const full = background === undefined ? undefined : hexDigits(background);
  if (full === undefined) return false;
  const [red, green, blue] = [0, 2, 4].map((at) => parseInt(full.slice(at, at + 2), 16) / 255);
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue > 0.5;
};

/** A translucent hex colour as seen over an opaque one, as opaque `#RRGGBB`;
 * undefined if either isn't a hex colour. */
export const seenOver = (color: string, background: string): string | undefined => {
  const over = hexDigits(color);
  const under = hexDigits(background);
  if (over === undefined || under === undefined) return undefined;
  const alpha = over.length === 8 ? parseInt(over.slice(6), 16) / 255 : 1;
  const channel = (at: number): string =>
    Math.round(parseInt(over.slice(at, at + 2), 16) * alpha + parseInt(under.slice(at, at + 2), 16) * (1 - alpha))
      .toString(16)
      .padStart(2, "0");
  return `#${channel(0)}${channel(2)}${channel(4)}`.toUpperCase();
};

/** A theme's merge colours, from its `colors`. */
export const mergeColorsOf = (colors: Readonly<Record<string, string>> | undefined): MergeColors => {
  const currentHeader = colors?.["merge.currentHeaderBackground"] ?? CURRENT_HEADER;
  const incomingHeader = colors?.["merge.incomingHeaderBackground"] ?? INCOMING_HEADER;
  return {
    currentHeader,
    incomingHeader,
    currentContent: colors?.["merge.currentContentBackground"] ?? transparent(currentHeader, CONTENT_TRANSPARENCY) ?? currentHeader,
    incomingContent: colors?.["merge.incomingContentBackground"] ?? transparent(incomingHeader, CONTENT_TRANSPARENCY) ?? incomingHeader,
  };
};
