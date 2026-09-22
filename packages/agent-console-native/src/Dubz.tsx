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
import { GlassContainer, GlassView } from "expo-glass-effect";
import * as React from "react";
import { Keyboard, Pressable, StyleSheet, TextInput, useColorScheme, useWindowDimensions, View } from "react-native";
import Reanimated, { Easing, useAnimatedKeyboard, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AGENT_NAME } from "./agentButtonSettings";
import { colors } from "./colors";

/** Gap between the window and the screen edges / the keyboard. */
const MARGIN = 12;
/** Corner radius of the glass window. */
const WINDOW_RADIUS = 30;
/** Grow/shrink duration (ms) for the window opening and closing. */
const ANIM_MS = 320;
/** The window grows from this fraction of full size up to 1 as it opens — a
 * LAYOUT scale (edge insets), never a transform, so the glass keeps rendering. */
const GROW_FROM = 0.72;

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
 * only while open.
 */
export const DubzOverlay = (): React.ReactElement | null => {
  const { isOpen, close } = useDubz();
  const insets = useSafeAreaInsets();
  const scheme = useColorScheme();
  const keyboard = useAnimatedKeyboard();
  const { width: screenW, height: screenH } = useWindowDimensions();

  // `visible` mounts the tree; `grow` (0→1) scales the window up by animating its
  // LAYOUT bounds — never a transform/opacity, which would composite the subtree
  // and stop the glass rendering (opacity 0 on the GlassView or any parent kills
  // it outright). So the entrance is a real size grow with live glass throughout.
  const [visible, setVisible] = React.useState(false);
  const grow = useSharedValue(0);
  const closeTimer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  React.useEffect(() => {
    if (isOpen) {
      if (closeTimer.current !== undefined) {
        clearTimeout(closeTimer.current);
        closeTimer.current = undefined;
      }
      setVisible(true);
      grow.value = withTiming(1, { duration: ANIM_MS, easing: Easing.out(Easing.cubic) });
    } else if (visible) {
      Keyboard.dismiss();
      grow.value = withTiming(0, { duration: ANIM_MS, easing: Easing.in(Easing.cubic) });
      closeTimer.current = setTimeout(() => setVisible(false), ANIM_MS + 40);
    }
  }, [isOpen, visible, grow]);

  React.useEffect(() => () => {
    if (closeTimer.current !== undefined) clearTimeout(closeTimer.current);
  }, []);

  // Grow via LAYOUT (edge insets), not transform: top under the safe area, bottom
  // rides the keyboard, and `grow` insets all four edges toward the centre at the
  // start so the window scales from GROW_FROM up to full. Layout animation keeps
  // the glass rendering; a transform/opacity would composite and break it.
  const windowStyle = useAnimatedStyle(() => {
    const top = insets.top + MARGIN;
    const bottom = Math.max(keyboard.height.value, insets.bottom) + MARGIN;
    const fullW = screenW - 2 * MARGIN;
    const fullH = screenH - top - bottom;
    const scale = GROW_FROM + (1 - GROW_FROM) * grow.value;
    const insetX = (fullW * (1 - scale)) / 2;
    const insetY = (fullH * (1 - scale)) / 2;
    return {
      top: top + insetY,
      bottom: bottom + insetY,
      left: MARGIN + insetX,
      right: MARGIN + insetX,
    };
  });

  if (!visible) return null;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {/* Transparent tap-catcher — tap outside to dismiss; no visible background. */}
      <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityRole="button" accessibilityLabel="Close Dubz" />

      {/* The clear glass window, hosted in a GlassContainer. See-through with
       * refraction (no tint, no scrim); the autofocused input pops the keyboard
       * so the window sits above it. */}
      <Reanimated.View style={[styles.window, windowStyle]}>
        <GlassContainer style={styles.glassContainer}>
          <GlassView
            style={styles.glass}
            glassEffectStyle="clear"
            // A slight dark tint (tints the glass material, not a solid fill) to
            // give the clear glass some body over bright content.
            tintColor="rgba(0,0,0,0.18)"
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
        </GlassContainer>
      </Reanimated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  // The wrapper carries ONLY position — no borderRadius / overflow / shadow. Any
  // rounding or clipping on a parent of the GlassView clips iOS's native glass
  // distortion context; the rounding lives on the GlassView itself.
  window: {
    position: "absolute",
  },
  glassContainer: {
    flex: 1,
    width: "100%",
    height: "100%",
  },
  // Explicit 100% size (not just flex) — the native clear backdrop can't resolve
  // its bounds from flex wrapping alone. Rounding lives here, on the glass.
  glass: {
    width: "100%",
    height: "100%",
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
