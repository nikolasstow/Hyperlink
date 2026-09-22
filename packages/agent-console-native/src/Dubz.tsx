/**
 * Dubz — the app-wide assistant surface. Tapping any {@link AgentButton} opens a
 * big glass window that animates in and fills most of the screen above the
 * keyboard, with margins all round (like tapping the composer pill, but instead
 * of the pill growing, this whole window appears).
 *
 * It's a single GLOBAL overlay mounted once at the app root (see App.tsx), driven
 * by {@link DubzProvider}'s open/closed state — so the same window opens from
 * Home, a repo page, the search pill, wherever Dubz is shown. `useDubz().open()`
 * opens it.
 *
 * For now this is JUST the glass window (keyboard pops up via an autofocused
 * field, but with only placeholder text inside). The actual Dubz agent — chat,
 * content, controls — is a separate later spec that fills this shell in.
 *
 * Glass invariants (learned the hard way — see AgentButton / RepoScreen):
 * - Round the GlassView via `borderRadius` on the GlassView itself (native
 *   UIGlassEffect corner config); never clip it with an `overflow: hidden`
 *   parent — that crops the material.
 * - Never animate the GlassView's own opacity (it stops rendering glass). The
 *   entrance animates a WRAPPER's opacity/scale; the GlassView stays opaque.
 * - Mount the overlay only while open, so the GlassView gets a fresh first-mount
 *   glass init each time (its glass initialises once per mount).
 *
 * @internal
 */
import { GlassView } from "expo-glass-effect";
import * as React from "react";
import { Keyboard, Pressable, StyleSheet, TextInput, useColorScheme, View } from "react-native";
import Reanimated, {
  Easing,
  runOnJS,
  useAnimatedKeyboard,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AGENT_NAME } from "./agentButtonSettings";
import { colors } from "./colors";

/** Gap between the window and the screen edges / the keyboard. */
const MARGIN = 12;
/** Corner radius of the glass window. */
const WINDOW_RADIUS = 30;
/** Entrance/exit timing. */
const OPEN_MS = 280;
const CLOSE_MS = 220;

interface DubzApi {
  readonly open: () => void;
  readonly close: () => void;
  readonly isOpen: boolean;
}

const DubzContext = React.createContext<DubzApi | undefined>(undefined);

/** Opens/closes the app-wide Dubz window. Must be under {@link DubzProvider}. */
export const useDubz = (): DubzApi => {
  const api = React.useContext(DubzContext);
  if (api === undefined) throw new Error("useDubz must be used within a DubzProvider");
  return api;
};

export const DubzProvider = (props: { readonly children: React.ReactNode }): React.ReactElement => {
  const [isOpen, setIsOpen] = React.useState(false);
  const open = React.useCallback(() => setIsOpen(true), []);
  const close = React.useCallback(() => setIsOpen(false), []);
  const api = React.useMemo<DubzApi>(() => ({ open, close, isOpen }), [open, close, isOpen]);
  return <DubzContext.Provider value={api}>{props.children}</DubzContext.Provider>;
};

/**
 * The overlay itself — rendered once at the root, ABOVE the navigator. Mounts
 * only while open (fresh glass each time); the exit animation keeps it mounted a
 * beat longer via `visible`.
 */
export const DubzOverlay = (): React.ReactElement | null => {
  const { isOpen, close } = useDubz();
  const insets = useSafeAreaInsets();
  const scheme = useColorScheme();
  const keyboard = useAnimatedKeyboard();

  // `visible` keeps the tree mounted through the exit animation; `progress`
  // (0→1) drives the scale/fade.
  const [visible, setVisible] = React.useState(false);
  const progress = useSharedValue(0);

  // Open/close manages `visible`. On close, animate out first, then unmount.
  React.useEffect(() => {
    if (isOpen) {
      setVisible(true);
    } else if (visible) {
      Keyboard.dismiss();
      progress.value = withTiming(0, { duration: CLOSE_MS, easing: Easing.in(Easing.cubic) }, (finished) => {
        if (finished) runOnJS(setVisible)(false);
      });
    }
  }, [isOpen, visible, progress]);

  // Animate IN only once the window is actually mounted, so the entrance always
  // runs from 0 (starting the timing before mount can skip the animation).
  React.useEffect(() => {
    if (!visible) return;
    progress.value = 0;
    progress.value = withTiming(1, { duration: OPEN_MS, easing: Easing.out(Easing.cubic) });
  }, [visible, progress]);

  // The window: fixed top (safe area + margin), bottom rides the keyboard, and it
  // rises + fades in. The GlassView keeps opacity 1 — only this wrapper animates.
  const windowStyle = useAnimatedStyle(() => ({
    top: insets.top + MARGIN,
    left: MARGIN,
    right: MARGIN,
    bottom: Math.max(keyboard.height.value, insets.bottom) + MARGIN,
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * 20 }, { scale: 0.96 + 0.04 * progress.value }],
  }));

  if (!visible) return null;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {/* Transparent tap-catcher — tap outside to dismiss; no visible background. */}
      <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityRole="button" accessibilityLabel="Close Dubz" />

      {/* Transparent glass window. `clear` (no tint, no background fill) keeps it
       * see-through; `isInteractive` makes the glass MATERIAL — edges, specular,
       * refraction — actually render, so it reads as glass rather than nothing.
       * The autofocused input pops the keyboard so the window sits above it. */}
      <Reanimated.View style={[styles.window, windowStyle]}>
        <GlassView
          style={styles.glass}
          glassEffectStyle="clear"
          isInteractive
          colorScheme={scheme === "dark" ? "dark" : "light"}
        >
          <TextInput
            style={styles.input}
            placeholder={`Ask ${AGENT_NAME}…`}
            placeholderTextColor={colors.placeholderText}
            autoFocus
            multiline
          />
        </GlassView>
      </Reanimated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  window: {
    position: "absolute",
    borderRadius: WINDOW_RADIUS,
    borderCurve: "continuous",
    // A soft lift so the transparent glass reads as a floating pane over the app.
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 24,
  },
  glass: {
    flex: 1,
    borderRadius: WINDOW_RADIUS,
    borderCurve: "continuous",
    padding: 18,
  },
  input: {
    flex: 1,
    color: colors.label,
    fontSize: 16,
    textAlignVertical: "top",
  },
});
