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
import { useAppContextOptional } from "./AppContext";
import { getCreatedTheme } from "./createdThemes";
import { Effect } from "effect";
import { forkApp, runApp } from "./effect/runtime";
import { fetchThemeJson, shikiThemeOfJson } from "./extensionsClient";
import { KeptThemes } from "./KeptThemes";
import { type CodeTheme, type Theme } from "./settings";
import { FALLBACK_THEME, shikiThemeOf } from "./shikiHighlighter";
import { useTheme } from "./theme";

type Scheme = "light" | "dark";

const fallbackFor = (scheme: Scheme): string | ThemeRegistrationRaw =>
  scheme === "dark" ? FALLBACK_THEME.dark : FALLBACK_THEME.light;

/** The theme identity (scheme + enabled theme), the key for the resolved cache. */
const themeKey = (scheme: Scheme, enabled: { readonly file?: string; readonly createdId?: string } | undefined): string =>
  `${scheme}:${enabled === undefined ? "none" : enabled.createdId !== undefined ? `c:${enabled.createdId}` : `f:${enabled.file}`}`;

/** The code theme in effect for a scheme: the dark slot in dark mode when dual
 * is on (falling back to the light slot until a dark theme is picked), else the
 * single `code`. Shared so the preview's split halves and the live editor
 * resolve the same way. */
export const effectiveCode = (theme: Theme, scheme: Scheme): CodeTheme | undefined =>
  theme.codeDual === true && scheme === "dark" ? (theme.codeDark ?? theme.code) : theme.code;

/** Resolved themes, cached process-wide so every editor mount gets the right
 * theme synchronously instead of flashing the default while it re-resolves.
 * Warmed the first time the theme is used (Home uses it), so file opens are
 * instant and correctly themed. */
const resolvedThemes = new Map<string, string | ThemeRegistrationRaw>();

/** Extension themes kept on the device (KeptThemes.ts), by file: what an
 * editor draws in before the server answers after a launch. */
const keptByFile = new Map<string, ThemeRegistrationRaw>();

let started = false;
let readBack: () => void = () => undefined;
/** Settles once the kept themes have been read back (the app waits for it,
 * so the first file opened is drawn in its theme). */
export const keptThemesReadBack = new Promise<void>((resolve) => {
  readBack = resolve;
});

/** Reads back the kept themes (once, at launch). */
export const startKeptThemes = (): void => {
  if (started) return;
  started = true;
  forkApp(
    Effect.gen(function* () {
      return yield* (yield* KeptThemes).all;
    }).pipe(
      Effect.tap((all) =>
        Effect.sync(() => {
          for (const [file, theme] of Object.entries(all)) keptByFile.set(file, { ...shikiThemeOfJson(theme), name: file });
        }),
      ),
      Effect.ensuring(Effect.sync(() => readBack())),
    ),
  );
};

/** The kept copy of an enabled extension theme, if the device has one. */
const keptFor = (enabled: { readonly file?: string; readonly createdId?: string } | undefined): ThemeRegistrationRaw | undefined =>
  enabled?.createdId === undefined && enabled?.file !== undefined ? keptByFile.get(enabled.file) : undefined;

/** Resolve a specific enabled code theme for a specific scheme. The split
 * preview resolves both slots at once with this; `useCodeTheme` resolves the
 * effective one for the live appearance. */
export const useResolvedCodeTheme = (enabled: CodeTheme | undefined, scheme: Scheme): string | ThemeRegistrationRaw => {
  // Optional: this runs on the launch screen too (resolving the theme
  // background), before the app has connected and the provider is mounted. With
  // no server, bundled and device-created themes still resolve; only an
  // extension theme's fetch is skipped (it falls back until there is one).
  const ctx = useAppContextOptional();
  const apiBase = ctx === undefined ? undefined : ctx.server;
  const key = themeKey(scheme, enabled);

  // Seed from the cache synchronously: if the theme's already resolved, the
  // first frame is correct — no default-then-correct flash.
  const [value, setValue] = React.useState<string | ThemeRegistrationRaw>(() => resolvedThemes.get(key) ?? keptFor(enabled) ?? fallbackFor(scheme));

  React.useEffect(() => {
    let cancelled = false;
    // On a theme switch (key change), show the cached resolution at once.
    const cached = resolvedThemes.get(key) ?? keptFor(enabled);
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
    } else if (apiBase !== undefined) {
      const file = enabled.file;
      // Kept on the device as it arrives, for the next launch.
      void fetchThemeJson(apiBase, file)
        .then((json) => {
          const theme = { ...shikiThemeOfJson(json), name: file };
          keptByFile.set(file, theme);
          remember(theme);
          return runApp(
            Effect.gen(function* () {
              yield* (yield* KeptThemes).keep(file, json);
            }),
          );
        })
        .catch((error: unknown) => console.warn("[themes] fetching the theme failed", error));
    }
    return () => {
      cancelled = true;
    };
  }, [apiBase, key, scheme, enabled]);

  return value;
};

/** The Shiki theme for the live appearance: the effective code theme (dual-aware)
 * resolved for the device's current colour scheme. */
export const useCodeTheme = (): string | ThemeRegistrationRaw => {
  const { theme } = useTheme();
  const scheme: Scheme = useColorScheme() === "dark" ? "dark" : "light";
  return useResolvedCodeTheme(effectiveCode(theme, scheme), scheme);
};
