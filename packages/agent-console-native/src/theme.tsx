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
import { useColorScheme, type ColorValue } from "react-native";
import { colors } from "./colors";
import { DEFAULT_THEME, getStoredTheme, setStoredTheme, type Theme } from "./settings";

/** Derived colours computed from a theme's `primary`/`secondary`. */
export interface ThemeColors {
  readonly primary: string;
  readonly secondary: string;
  /** `primary` at low alpha — a light primary fill. */
  readonly primaryTint: string;
  /** `primary` at the alpha a glass tint needs to read as that colour — the
   * user's chat-bubble glass. */
  readonly bubbleGlassTint: string;
  /** `primary` mixed toward white — the send button's disabled/muted fill. */
  readonly primaryMuted: string;
  /** Send button, armed: `primary` slightly translucent so the glass shows. */
  readonly sendActiveFill: string;
  /** Send button, unarmed: the muted fill, same translucency. */
  readonly sendMutedFill: string;
  /** The assistant (Dubz) button's fill — `secondary` at the same translucency
   * as the send button's fill, so the two read as a matched pair (primary send,
   * secondary assistant) with white glyphs. */
  readonly secondaryFill: string;
  /** Dubz's send button, unarmed: `secondary` muted the way `sendMutedFill`
   * mutes `primary`, same translucency. */
  readonly secondaryMutedFill: string;
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
  const [sr, sg, sb] = toRgb(theme.secondary);
  const mute = (c: number): number => Math.round(c + (255 - c) * MUTE_FACTOR);
  const [mr, mg, mb] = [mute(pr), mute(pg), mute(pb)];
  const [msr, msg, msb] = [mute(sr), mute(sg), mute(sb)];
  return {
    primary: theme.primary,
    secondary: theme.secondary,
    primaryTint: `rgba(${pr}, ${pg}, ${pb}, 0.18)`,
    bubbleGlassTint: `rgba(${pr}, ${pg}, ${pb}, 0.4)`,
    primaryMuted: `rgb(${mr}, ${mg}, ${mb})`,
    sendActiveFill: `rgba(${pr}, ${pg}, ${pb}, ${SEND_FILL_ALPHA})`,
    sendMutedFill: `rgba(${mr}, ${mg}, ${mb}, ${SEND_FILL_ALPHA})`,
    secondaryFill: `rgba(${sr}, ${sg}, ${sb}, ${SEND_FILL_ALPHA})`,
    secondaryMutedFill: `rgba(${msr}, ${msg}, ${msb}, ${SEND_FILL_ALPHA})`,
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

/** The screens' background: the theme's for the current mode (Appearance →
 * Background), else the system's. `plain` screens (Files, output views) are
 * the system's plain background by default rather than the grouped one; a
 * custom colour is the same for every screen. Read live, so a change shows at
 * once. */
export const useScreenBackground = (kind: "grouped" | "plain" = "grouped"): ColorValue => {
  const { theme } = useTheme();
  const custom = useColorScheme() === "dark" ? theme.backgroundDark : theme.backgroundLight;
  return custom ?? (kind === "plain" ? colors.systemBackground : colors.background);
};

/** The system's screen background in each mode (systemGroupedBackground), for
 * judging how light the background is when the theme sets none. */
const SYSTEM_BACKGROUND_HEX = {
  light: "#F2F2F7",
  dark: "#000000",
};

/** Relative luminance (WCAG) of a hex colour, 0 (black) to 1 (white). */
export const luminance = (hex: string): number => {
  const channel = (value: number): number => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = toRgb(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};

/** Above this luminance a background counts as light. */
const LIGHT_BACKGROUND = 0.4;
/** The contrast when none is chosen (Appearance → Background): none, the
 * standard look, no tint. */
export const DEFAULT_CARD_CONTRAST = 0;
/** The tint's strongest, at full contrast: black over a light background,
 * white over a dark one (white reads weaker, so it goes further). */
const MAX_DARKEN_ALPHA = 0.15;
const MAX_LIGHTEN_ALPHA = 0.2;

/** The glass cards' tint, from how light the actual background is (the
 * theme's colour for this mode, else the system's), not from the mode: a
 * bright colour in dark mode still wants the darker tint. How much is the
 * theme's card contrast. */
export const useCardTint = (): string | undefined => {
  const { theme } = useTheme();
  const dark = useColorScheme() === "dark";
  const background = (dark ? theme.backgroundDark : theme.backgroundLight) ?? (dark ? SYSTEM_BACKGROUND_HEX.dark : SYSTEM_BACKGROUND_HEX.light);
  const contrast = theme.cardContrast ?? DEFAULT_CARD_CONTRAST;
  // No contrast is the standard glass, untinted.
  if (contrast <= 0) return undefined;
  return luminance(background) > LIGHT_BACKGROUND
    ? `rgba(0,0,0,${(MAX_DARKEN_ALPHA * contrast).toFixed(3)})`
    : `rgba(255,255,255,${(MAX_LIGHTEN_ALPHA * contrast).toFixed(3)})`;
};
