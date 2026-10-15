/**
 * The colours of an accepted `/name` in a composer: the code theme's
 * `chat.slashCommandBackground` and `chat.slashCommandForeground`, VS Code's
 * keys for this, with VS Code's own defaults when the theme has none.
 *
 * @internal
 */
import * as React from "react";
import { resolveThemeColors } from "../shikiHighlighter";
import { useCodeTheme } from "../useCodeTheme";

export interface SlashColors {
  readonly background: string;
  readonly foreground: string;
}

export const useSlashColors = (): SlashColors => {
  const theme = useCodeTheme();
  return React.useMemo(() => {
    const { colors, dark } = resolveThemeColors(theme);
    return {
      background: colors["chat.slashCommandBackground"] ?? (dark ? "#26477866" : "#adceff7a"),
      foreground: colors["chat.slashCommandForeground"] ?? (dark ? "#85b6ff" : "#26569e"),
    };
  }, [theme]);
};
