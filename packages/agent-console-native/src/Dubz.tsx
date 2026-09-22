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
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Reanimated, { Easing, runOnJS, useAnimatedKeyboard, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AGENT_NAME } from "./agentButtonSettings";
import { colors } from "./colors";

/** Gap between the window and the screen edges / the keyboard. */
const MARGIN = 12;
/** Corner radius of the glass window. */
const WINDOW_RADIUS = 30;
/** Grow/shrink duration (ms) for the window opening and closing. */
const ANIM_MS = 320;
/** The glass fades in (none → clear) over the first ~55% of the grow — native
 * glassEffectStyle `animate` (seconds), the only opacity-free way to fade glass. */
const FADE_S = (ANIM_MS * 0.55) / 1000;
/** Smallest height the window shrinks to when the drag bar is pulled down. */
const MIN_HEIGHT = 160;
/** The top drag-bar area's height. */
const GRABBER_AREA_H = 30;
/** Snap-to-detent duration on drag release. */
const SNAP_MS = 240;

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
  const { height: screenH } = useWindowDimensions();

  // `visible` mounts the tree; `grow` (0→1) scales the window up by animating its
  // LAYOUT bounds — never a transform/opacity, which would composite the subtree
  // and stop the glass rendering (opacity 0 on the GlassView or any parent kills
  // it outright). So the entrance is a real size grow with live glass throughout.
  // `visible` mounts the tree; `entered` toggles the native glass none↔clear (its
  // own animate fades it, no opacity); `grow` scales the window via layout.
  const [visible, setVisible] = React.useState(false);
  const [entered, setEntered] = React.useState(false);
  // `lowered` = the window has been dragged below full; when true the tap-catcher
  // passes touches through so you can see/scroll what's behind (e.g. the code).
  const [lowered, setLowered] = React.useState(false);
  const grow = useSharedValue(0);
  const dragY = useSharedValue(0); // 0 = full height; positive = top lowered (shorter)
  const dragStart = useSharedValue(0);
  const closeTimer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Open/close manages `visible` + the shrink/fade-out (which is smooth as-is).
  React.useEffect(() => {
    if (isOpen) {
      if (closeTimer.current !== undefined) {
        clearTimeout(closeTimer.current);
        closeTimer.current = undefined;
      }
      setVisible(true);
    } else if (visible) {
      Keyboard.dismiss();
      setEntered(false); // glass fades clear → none
      grow.value = withTiming(0, { duration: ANIM_MS, easing: Easing.in(Easing.cubic) });
      dragY.value = withTiming(0, { duration: ANIM_MS });
      closeTimer.current = setTimeout(() => setVisible(false), ANIM_MS + 40);
    }
  }, [isOpen, visible, grow, dragY]);

  // Grow + fade IN only once the window has actually mounted (next frame), so the
  // timing doesn't start mid-mount / mid-glass-init — that's what dropped the
  // first frames (jitter) in; out was already mounted, hence smooth. The glass
  // fade (via glassEffectStyle animate) is short, so it lands ~30% into the grow.
  React.useEffect(() => {
    if (!visible) return undefined;
    grow.value = 0;
    dragY.value = 0;
    setLowered(false);
    const id = requestAnimationFrame(() => {
      grow.value = withTiming(1, { duration: ANIM_MS, easing: Easing.out(Easing.cubic) });
      setEntered(true);
    });
    return () => cancelAnimationFrame(id);
  }, [visible, grow, dragY]);

  React.useEffect(() => () => {
    if (closeTimer.current !== undefined) clearTimeout(closeTimer.current);
  }, []);

  // Drag the top bar down to lower the window (revealing what's behind), snapping
  // to detents like an iOS sheet — but anchored above the keyboard, not the very
  // bottom. `dragY` (px the top is lowered) is added to the window's top.
  const topInset = insets.top;
  const bottomInset = insets.bottom;
  const drag = React.useMemo(
    () =>
      Gesture.Pan()
        .onStart(() => {
          dragStart.value = dragY.value;
        })
        .onUpdate((e) => {
          const fullTop = topInset + MARGIN;
          const bottom = Math.max(keyboard.height.value, bottomInset) + MARGIN;
          const maxDrag = Math.max(screenH - fullTop - bottom - MIN_HEIGHT, 0);
          const next = dragStart.value + e.translationY;
          dragY.value = next < 0 ? 0 : next > maxDrag ? maxDrag : next;
        })
        .onEnd((e) => {
          const fullTop = topInset + MARGIN;
          const bottom = Math.max(keyboard.height.value, bottomInset) + MARGIN;
          const maxDrag = Math.max(screenH - fullTop - bottom - MIN_HEIGHT, 0);
          const detents = [0, maxDrag * 0.5, maxDrag];
          const projected = dragY.value + e.velocityY * 0.08;
          let target = 0;
          let best = 1e9;
          for (let i = 0; i < detents.length; i++) {
            const diff = projected - detents[i];
            const dist = diff < 0 ? -diff : diff;
            if (dist < best) {
              best = dist;
              target = detents[i];
            }
          }
          dragY.value = withTiming(target, { duration: SNAP_MS, easing: Easing.out(Easing.cubic) });
          runOnJS(setLowered)(target > 4);
        }),
    [screenH, topInset, bottomInset, dragY, dragStart, keyboard],
  );

  // Grows via LAYOUT (animating `top`), never a transform — a transform/opacity
  // would composite the subtree and stop the glass rendering. Full width the whole
  // time (left/right fixed); the bottom is anchored at the keyboard, and the top
  // animates from the bottom edge (0 height) up to the full top — so the window
  // unfolds upward from the bottom.
  const windowStyle = useAnimatedStyle(() => {
    const fullTop = insets.top + MARGIN;
    const bottom = Math.max(keyboard.height.value, insets.bottom) + MARGIN;
    const collapsedTop = screenH - bottom; // sitting on its own bottom edge = 0 height
    return {
      top: collapsedTop + (fullTop - collapsedTop) * grow.value + dragY.value,
      left: MARGIN,
      right: MARGIN,
      bottom,
    };
  });

  if (!visible) return null;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {/* Transparent tap-catcher — tap outside to dismiss (at full height). Once
       * lowered, it passes touches through so you can see/scroll what's behind. */}
      <Pressable
        style={StyleSheet.absoluteFill}
        pointerEvents={lowered ? "none" : "auto"}
        onPress={close}
        accessibilityRole="button"
        accessibilityLabel="Close Dubz"
      />

      {/* The clear glass window, hosted in a GlassContainer. See-through with
       * refraction (no tint, no scrim); the autofocused input pops the keyboard
       * so the window sits above it. */}
      <Reanimated.View style={[styles.window, windowStyle]}>
        <GlassContainer style={styles.glassContainer}>
          <GlassView
            style={styles.glass}
            // Fades in via the native animate (none → clear) — no opacity, which
            // would composite and kill the glass. Short duration so it finishes
            // ~30% into the grow.
            glassEffectStyle={{ style: entered ? "clear" : "none", animate: true, animationDuration: FADE_S }}
            // A slight dark tint (tints the glass material, not a solid fill) to
            // give the clear glass some body over bright content.
            tintColor="rgba(0,0,0,0.18)"
            colorScheme={scheme === "dark" ? "dark" : "light"}
          >
            {/* Drag bar — pull down to lower the window to a detent (see behind). */}
            <GestureDetector gesture={drag}>
              <View style={styles.grabberArea}>
                <View style={styles.grabber} />
              </View>
            </GestureDetector>
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
  },
  grabberArea: {
    height: GRABBER_AREA_H,
    alignItems: "center",
    justifyContent: "center",
  },
  grabber: {
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: "rgba(120,120,128,0.55)",
  },
  input: {
    flex: 1,
    color: colors.label,
    fontSize: 16,
    textAlignVertical: "top",
    paddingHorizontal: 18,
    paddingBottom: 18,
  },
});
