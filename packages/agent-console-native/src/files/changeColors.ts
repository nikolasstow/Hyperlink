/**
 * The colours an agent's change is marked in, read from the VS Code theme
 * the way VS Code reads them, with VS Code's own defaults where a theme sets
 * none:
 *
 * - the gutter stripes: `editorGutter.addedBackground` /
 *   `editorGutter.modifiedBackground`, and the deletion wedge
 *   `editorGutter.deletedBackground` (by default the theme's
 *   `editorError.foreground`);
 * - the flash as the change lands: `diffEditor.insertedLineBackground`, else
 *   `diffEditor.insertedTextBackground`, else VS Code's inserted green.
 *
 * @internal
 */

export interface ChangeColors {
  readonly added: string;
  readonly modified: string;
  readonly deleted: string;
  readonly flash: string;
}

/** VS Code's defaults (src/vs/workbench/contrib/scm/browser/dirtydiffDecorator.ts,
 * src/vs/platform/theme/common/colors/editorColors.ts), dark then light. */
const ADDED = { dark: "#487E02", light: "#48985D" };
const MODIFIED = { dark: "#1B81A8", light: "#2090D3" };
const ERROR = { dark: "#F14C4C", light: "#E51400" };
const INSERTED = "#9BB95533";

/** A theme's change colours, from its `colors`. */
export const changeColorsOf = (colors: Readonly<Record<string, string>> | undefined, light: boolean): ChangeColors => {
  const scheme = light ? "light" : "dark";
  return {
    added: colors?.["editorGutter.addedBackground"] ?? ADDED[scheme],
    modified: colors?.["editorGutter.modifiedBackground"] ?? MODIFIED[scheme],
    deleted: colors?.["editorGutter.deletedBackground"] ?? colors?.["editorError.foreground"] ?? ERROR[scheme],
    flash: colors?.["diffEditor.insertedLineBackground"] ?? colors?.["diffEditor.insertedTextBackground"] ?? INSERTED,
  };
};
