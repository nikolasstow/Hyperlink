/**
 * The Shiki theme for the app's enabled code theme, resolved the one way both
 * the Appearance preview and the file viewer need it:
 *
 * - no theme enabled → a bundled fallback matching the colour scheme,
 * - an installed extension theme → its JSON fetched from the extension server,
 * - a device-created theme → its own document from local storage.
 *
 * Keyed by theme identity (file or created id) and scheme, so it re-resolves
 * only when the enabled theme actually changes.
 *
 * @internal
 */
import type { ThemeRegistrationRaw } from "shiki/core";
import * as React from "react";
import { useColorScheme } from "react-native";
import { useAppContext } from "./AppContext";
import { getCreatedTheme } from "./createdThemes";
import { getThemeJson } from "./extensionsClient";
import { getApiAddress } from "./settings";
import { FALLBACK_THEME, shikiThemeOf } from "./shikiHighlighter";
import { useTheme } from "./theme";

export const useCodeTheme = (): string | ThemeRegistrationRaw => {
  const { theme } = useTheme();
  const { address } = useAppContext();
  const apiBase = getApiAddress(address);
  const scheme = useColorScheme();
  const enabled = theme.code;

  const [value, setValue] = React.useState<string | ThemeRegistrationRaw>(
    scheme === "dark" ? FALLBACK_THEME.dark : FALLBACK_THEME.light,
  );

  React.useEffect(() => {
    let cancelled = false;
    if (enabled === undefined) {
      setValue(scheme === "dark" ? FALLBACK_THEME.dark : FALLBACK_THEME.light);
      return;
    }
    if (enabled.createdId !== undefined) {
      const id = enabled.createdId;
      void getCreatedTheme(id)
        .then((mine) => {
          if (!cancelled && mine !== undefined) setValue(shikiThemeOf(mine.theme));
        })
        .catch(() => undefined);
      return () => {
        cancelled = true;
      };
    }
    const file = enabled.file;
    void getThemeJson(apiBase, file)
      .then((json) => {
        if (!cancelled) setValue({ ...json, name: file });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [apiBase, enabled?.file, enabled?.createdId, scheme]); // eslint-disable-line react-hooks/exhaustive-deps -- keyed by theme identity

  return value;
};
