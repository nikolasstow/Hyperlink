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

const fallbackFor = (scheme: ReturnType<typeof useColorScheme>): string | ThemeRegistrationRaw =>
  scheme === "dark" ? FALLBACK_THEME.dark : FALLBACK_THEME.light;

/** The theme identity (scheme + enabled theme), the key for the resolved cache. */
const themeKey = (scheme: ReturnType<typeof useColorScheme>, enabled: { readonly file?: string; readonly createdId?: string } | undefined): string =>
  `${scheme === "dark" ? "dark" : "light"}:${enabled === undefined ? "none" : enabled.createdId !== undefined ? `c:${enabled.createdId}` : `f:${enabled.file}`}`;

/** Resolved themes, cached process-wide so every editor mount gets the right
 * theme synchronously instead of flashing the default while it re-resolves.
 * Warmed the first time the theme is used (Home uses it), so file opens are
 * instant and correctly themed. */
const resolvedThemes = new Map<string, string | ThemeRegistrationRaw>();

export const useCodeTheme = (): string | ThemeRegistrationRaw => {
  const { theme } = useTheme();
  const { address } = useAppContext();
  const apiBase = getApiAddress(address);
  const scheme = useColorScheme();
  const enabled = theme.code;
  const key = themeKey(scheme, enabled);

  // Seed from the cache synchronously: if the theme's already resolved, the
  // first frame is correct — no default-then-correct flash.
  const [value, setValue] = React.useState<string | ThemeRegistrationRaw>(() => resolvedThemes.get(key) ?? fallbackFor(scheme));

  React.useEffect(() => {
    let cancelled = false;
    // On a theme switch (key change), show the cached resolution at once.
    const cached = resolvedThemes.get(key);
    if (cached !== undefined) setValue(cached);

    const remember = (resolved: string | ThemeRegistrationRaw): void => {
      resolvedThemes.set(key, resolved);
      if (!cancelled) setValue(resolved);
    };

    if (enabled === undefined) {
      remember(fallbackFor(scheme));
    } else if (enabled.createdId !== undefined) {
      const id = enabled.createdId;
      void getCreatedTheme(id)
        .then((mine) => {
          if (mine !== undefined) remember(shikiThemeOf(mine.theme));
        })
        .catch(() => undefined);
    } else {
      const file = enabled.file;
      void getThemeJson(apiBase, file)
        .then((json) => remember({ ...json, name: file }))
        .catch(() => undefined);
    }
    return () => {
      cancelled = true;
    };
  }, [apiBase, key, scheme, enabled]); // eslint-disable-line react-hooks/exhaustive-deps -- identity captured by key

  return value;
};
