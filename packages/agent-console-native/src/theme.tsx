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

/** Relative luminance (WCAG) of a hex colour, 0 (black) to 1 (white). */
export const luminance = (hex: string): number => luminanceOf(toRgb(hex));

/** Relative luminance (WCAG) of an sRGB colour, 0 to 1. */
const luminanceOf = ([r, g, b]: readonly [number, number, number]): number => {
  const channel = (value: number): number => {
    const c = value / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};

/** Where Increase Contrast's slider starts when turned on: the middle. */
export const CONTRAST_START = 0.5;
/** The glass's brightening at full contrast. */
const MAX_BRIGHTEN_ALPHA = 0.2;

/** The glass cards' tint: Increase Contrast (Appearance) only brightens them,
 * a white tint as strong as its slider; off, the standard glass, untinted. */
export const useCardTint = (): string | undefined => {
  const { theme } = useTheme();
  const mode = useColorScheme() === "dark" ? "dark" : "light";
  const contrast = theme.contrast?.[mode];
  return contrast === undefined || contrast <= 0 ? undefined : `rgba(255,255,255,${(MAX_BRIGHTEN_ALPHA * contrast).toFixed(3)})`;
};

/** WCAG contrast ratio between two colours' luminances, 1 (none) to 21. The
 * 0.05 is the display's flare, which keeps near-black from reading as
 * infinitely far from everything. */
export const contrastRatio = (a: number, b: number): number => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

/** The text colours, the four iOS text colours' roles. */
export interface TextColors {
  readonly label: ColorValue;
  readonly secondaryLabel: ColorValue;
  readonly tertiaryLabel: ColorValue;
  readonly placeholderText: ColorValue;
}

/** iOS's own text colours, which follow the mode: used while the background
 * is the system's. */
const SYSTEM_TEXT: TextColors = {
  label: colors.label,
  secondaryLabel: colors.secondaryLabel,
  tertiaryLabel: colors.tertiaryLabel,
  placeholderText: colors.placeholderText,
};

/** The secondary text of each palette (iOS's): a colour at 60%, so what is
 * read is it blended over the background. */
const SECONDARY_ALPHA = 0.6;
const SECONDARY_DARK: readonly [number, number, number] = [60, 60, 67];
const SECONDARY_LIGHT: readonly [number, number, number] = [235, 235, 245];

/** Text for a light background, in either mode: iOS's light-mode values. */
const TEXT_ON_LIGHT: TextColors = {
  label: "#000000",
  secondaryLabel: "rgba(60,60,67,0.6)",
  tertiaryLabel: "rgba(60,60,67,0.3)",
  placeholderText: "rgba(60,60,67,0.3)",
};

/** Text for a dark background, in either mode: iOS's dark-mode values. */
const TEXT_ON_DARK: TextColors = {
  label: "#FFFFFF",
  secondaryLabel: "rgba(235,235,245,0.6)",
  tertiaryLabel: "rgba(235,235,245,0.3)",
  placeholderText: "rgba(235,235,245,0.3)",
};

/** A translucent colour over an opaque one, as seen. */
const blend = (
  over: readonly [number, number, number],
  alpha: number,
  under: readonly [number, number, number],
): readonly [number, number, number] => {
  const mix = (a: number, b: number): number => a * alpha + b * (1 - alpha);
  return [mix(over[0], under[0]), mix(over[1], under[1]), mix(over[2], under[2])];
};

/** The text for a background: whichever palette's secondary text contrasts
 * more with it (WCAG ratio), judged on the secondary because it is the
 * hardest to read (60% of its colour, blended into the background); where it
 * reads, the full-strength label does too. A bright saturated colour gets dark
 * text, a deep one light text. */
export const textFor = (background: string): TextColors => {
  const under = toRgb(background);
  const l = luminanceOf(under);
  const darkSecondary = contrastRatio(luminanceOf(blend(SECONDARY_DARK, SECONDARY_ALPHA, under)), l);
  const lightSecondary = contrastRatio(luminanceOf(blend(SECONDARY_LIGHT, SECONDARY_ALPHA, under)), l);
  return darkSecondary >= lightSecondary ? TEXT_ON_LIGHT : TEXT_ON_DARK;
};

/** The text colours for the background: light text on a darkish colour, dark
 * text on a light one, whatever the mode (a dark background in light mode
 * still wants light text; the mode is untouched). With the system's
 * background, iOS's own colours. */
export const useTextColors = (): TextColors => {
  const { theme } = useTheme();
  const custom = useColorScheme() === "dark" ? theme.backgroundDark : theme.backgroundLight;
  if (custom === undefined) return SYSTEM_TEXT;
  return textFor(custom);
};

/** A component's styles built with the text colours for the background:
 * `makeStyles` runs again only when those change. */
export const useThemedStyles = <T,>(makeStyles: (text: TextColors) => T): T => {
  const text = useTextColors();
  return React.useMemo(() => makeStyles(text), [makeStyles, text]);
};
