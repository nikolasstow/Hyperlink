/**
 * The colours a problem's wavy line is drawn in, read from the VS Code theme
 * the way VS Code reads them (`editorError.foreground`,
 * `editorWarning.foreground`, `editorInfo.foreground`,
 * `editorHint.foreground`), with VS Code's own defaults where a theme sets
 * none.
 *
 * @internal
 */

export interface DiagnosticColors {
  readonly error: string;
  readonly warning: string;
  readonly info: string;
  readonly hint: string;
}

/** VS Code's defaults (src/vs/platform/theme/common/colors/editorColors.ts),
 * dark then light. */
const DEFAULTS = {
  error: { dark: "#F14C4C", light: "#E51400" },
  warning: { dark: "#CCA700", light: "#BF8803" },
  info: { dark: "#3794FF", light: "#1A85FF" },
  hint: { dark: "#EEEEEEB3", light: "#6C6C6C" },
};

/** A theme's problem colours, from its `colors`. */
export const diagnosticColorsOf = (colors: Readonly<Record<string, string>> | undefined, light: boolean): DiagnosticColors => {
  const scheme = light ? "light" : "dark";
  return {
    error: colors?.["editorError.foreground"] ?? DEFAULTS.error[scheme],
    warning: colors?.["editorWarning.foreground"] ?? DEFAULTS.warning[scheme],
    info: colors?.["editorInfo.foreground"] ?? DEFAULTS.info[scheme],
    hint: colors?.["editorHint.foreground"] ?? DEFAULTS.hint[scheme],
  };
};
