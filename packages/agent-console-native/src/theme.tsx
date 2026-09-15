/**
 * The app's colour theme — a `primary` and a `secondary` accent that the user
 * (and, later, an installed VS Code colour theme) can set. Distinct from
 * colors.ts, which holds the fixed iOS semantic palette; this is the small,
 * mutable, themeable slice:
 *
 *  - `primary` — the send button, and (as a low-alpha tint) the user's chat
 *    bubble.
 *  - `secondary` — accents such as the unread dot.
 *
 * Held in a context so a change re-renders every consumer. Loaded from
 * on-device storage on mount (falling back to defaults); `setTheme` persists.
 * Server sync (so multiple devices match) rides on top of this — see the
 * extension/sync handoff doc.
 *
 * @internal
 */
import * as React from "react";
import { DEFAULT_THEME, getStoredTheme, setStoredTheme, type Theme } from "./settings";

/** Derived colours computed from a theme's `primary`/`secondary`. */
export interface ThemeColors {
  readonly primary: string;
  readonly secondary: string;
  /** `primary` at low alpha — the user's chat-bubble fill. */
  readonly primaryTint: string;
  /** `primary` mixed toward white — the send button's disabled/muted fill. */
  readonly primaryMuted: string;
  /** Send button, armed: `primary` slightly translucent so the glass shows. */
  readonly sendActiveFill: string;
  /** Send button, unarmed: the muted fill, same translucency. */
  readonly sendMutedFill: string;
}

interface ThemeContextValue {
  readonly theme: Theme;
  readonly colors: ThemeColors;
  readonly setTheme: (theme: Theme) => void;
  /** False until the stored theme has loaded (defaults are shown meanwhile). */
  readonly ready: boolean;
}

const ThemeContext = React.createContext<ThemeContextValue | undefined>(undefined);

/** Parse `#RGB`/`#RRGGBB` to its channels; falls back to mid-grey on garbage. */
const toRgb = (hex: string): readonly [number, number, number] => {
  const clean = hex.replace("#", "");
  const full = clean.length === 3 ? clean.replace(/(.)/g, "$1$1") : clean;
  const int = Number.parseInt(full, 16);
  if (full.length !== 6 || Number.isNaN(int)) return [142, 142, 147];
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
};

/** Send button fill translucency, so the button's glass shows through. */
const SEND_FILL_ALPHA = 0.85;
/** How far the muted (unarmed) fill is mixed toward white. */
const MUTE_FACTOR = 0.32;

export const deriveColors = (theme: Theme): ThemeColors => {
  const [pr, pg, pb] = toRgb(theme.primary);
  const mute = (c: number): number => Math.round(c + (255 - c) * MUTE_FACTOR);
  const [mr, mg, mb] = [mute(pr), mute(pg), mute(pb)];
  return {
    primary: theme.primary,
    secondary: theme.secondary,
    primaryTint: `rgba(${pr}, ${pg}, ${pb}, 0.18)`,
    primaryMuted: `rgb(${mr}, ${mg}, ${mb})`,
    sendActiveFill: `rgba(${pr}, ${pg}, ${pb}, ${SEND_FILL_ALPHA})`,
    sendMutedFill: `rgba(${mr}, ${mg}, ${mb}, ${SEND_FILL_ALPHA})`,
  };
};

export const ThemeProvider = (props: { readonly children: React.ReactNode }): React.ReactElement => {
  const [theme, setThemeState] = React.useState<Theme>(DEFAULT_THEME);
  const [ready, setReady] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    void getStoredTheme().then((stored) => {
      if (cancelled) return;
      if (stored !== undefined) setThemeState(stored);
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const setTheme = React.useCallback((next: Theme): void => {
    setThemeState(next);
    void setStoredTheme(next);
  }, []);

  const value = React.useMemo<ThemeContextValue>(
    () => ({
      theme,
      colors: deriveColors(theme),
      setTheme,
      ready,
    }),
    [theme, setTheme, ready],
  );

  return <ThemeContext.Provider value={value}>{props.children}</ThemeContext.Provider>;
};

export const useTheme = (): ThemeContextValue => {
  const value = React.useContext(ThemeContext);
  if (value === undefined) throw new Error("useTheme() called outside ThemeProvider");
  return value;
};
