/**
 * The colours a tree/outline pane paints itself with, taken from the enabled
 * code theme the way a VS Code side-bar pane does. The file browser's folder
 * view uses this, and so do extension-provided tree views, so a pane reads as
 * part of the theme rather than the iOS chrome around it.
 *
 * Resolved from the same theme `useCodeTheme` gives the editor (an installed or
 * created theme's `colors`, or a bundled fallback's), with VS Code's own key
 * fallbacks: a missing `sideBar.background` falls back to the editor background,
 * a missing foreground walks `sideBar` → `list` → generic → editor, and the row
 * rules follow the indent-guide / side-bar border, then a faint tint.
 *
 * @internal
 */
import * as React from "react";
import { resolveThemeColors } from "./shikiHighlighter";
import { useCodeTheme } from "./useCodeTheme";

export interface TreePaneColors {
  /** The pane surface. */
  readonly background: string;
  /** Item (file/folder) text. */
  readonly foreground: string;
  /** Disclosure chevron and generic row glyphs. */
  readonly icon: string;
  /** Row separators / indent guides. */
  readonly separator: string;
  /** Whether the theme is dark (for anything that must branch on it). */
  readonly dark: boolean;
}

export const useTreePaneColors = (): TreePaneColors => {
  const theme = useCodeTheme();
  return React.useMemo(() => {
    const { colors, dark } = resolveThemeColors(theme);
    const first = (...keys: ReadonlyArray<string>): string | undefined => {
      for (const key of keys) {
        const value = colors[key];
        if (value !== undefined && value.length > 0) return value;
      }
      return undefined;
    };
    const foreground = first("sideBar.foreground", "list.foreground", "foreground", "editor.foreground") ?? (dark ? "#CCCCCC" : "#333333");
    return {
      background: first("sideBar.background", "editor.background") ?? (dark ? "#1E1E1E" : "#FFFFFF"),
      foreground,
      icon: first("icon.foreground", "sideBar.foreground", "foreground") ?? foreground,
      separator: first("tree.indentGuidesStroke", "sideBar.border", "editorIndentGuide.background") ?? (dark ? "rgba(255,255,255,0.09)" : "rgba(0,0,0,0.09)"),
      dark,
    };
  }, [theme]);
};
