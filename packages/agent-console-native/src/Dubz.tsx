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
import { Ionicons } from "@expo/vector-icons";
import { GlassContainer, GlassView } from "expo-glass-effect";
import * as React from "react";
import { Keyboard, Pressable, StyleSheet, TextInput, useColorScheme, useWindowDimensions, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Reanimated, { Easing, runOnJS, useAnimatedKeyboard, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AGENT_NAME } from "./agentButtonSettings";
import { colors } from "./colors";
import { useTheme } from "./theme";

/** Gap between the window and the screen edges / the keyboard. */
const MARGIN = 12;
/** Corner radius of the glass window. */
const WINDOW_RADIUS = 30;
/** Grow/shrink duration (ms) for the window opening and closing. */
const ANIM_MS = 320;
/** The glass fades in (none → clear) over the first ~55% of the grow — native
 * glassEffectStyle `animate` (seconds), the only opacity-free way to fade glass. */
const FADE_S = (ANIM_MS * 0.55) / 1000;
/** Smallest height — the "pill" detent. Pill-shaped at the window radius (the
 * grabber overlays the composer here rather than stacking above it). */
const MIN_HEIGHT = 60;
/** The top drag-bar area's height. */
const GRABBER_AREA_H = 30;
/** Snap-to-detent duration on drag release. */
const SNAP_MS = 240;
/** Fling-down velocity (px/s) that dismisses the window. */
const FLING_VELOCITY = 1400;
/** How far past the last detent you can keep pulling, and the release point past
 * which (last detent + margin) the window dismisses instead of snapping back. */
const DISMISS_ZONE = 120;
const DISMISS_MARGIN = 48;

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
 * Mounted once at the root, but the heavy window — its `useAnimatedKeyboard`
 * tracking, gestures and layout animation — is only mounted while Dubz is open.
 * Keeping those hooks alive when closed ran a global keyboard listener (fighting
 * the composer's) and bogged the whole app down.
 */
export const DubzOverlay = (): React.ReactElement | null => {
  const { isOpen } = useDubz();
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => {
    if (isOpen) setMounted(true);
  }, [isOpen]);
  if (!mounted) return null;
  return <DubzWindow onClosed={() => setMounted(false)} />;
};

/** The window itself — mounted only while open (and through its exit animation). */
const DubzWindow = ({ onClosed }: { readonly onClosed: () => void }): React.ReactElement => {
  const { isOpen, close } = useDubz();
  const insets = useSafeAreaInsets();
  const scheme = useColorScheme();
  const { colors: themeColors } = useTheme();
  // Destructure the height SHARED VALUE — capturing the whole useAnimatedKeyboard
  // object (KeyboardImpl) in a worklet fails to serialize to the UI thread.
  const { height: kbHeight } = useAnimatedKeyboard();
  const { height: screenH } = useWindowDimensions();
  const [text, setText] = React.useState("");

  // `entered` toggles the native glass none↔clear (its own animate fades it, no
  // opacity); `grow` (0→1) scales the window via LAYOUT (never a transform, which
  // would composite and kill the glass); `dragY` is the drag-bar offset.
  const [entered, setEntered] = React.useState(false);
  // `lowered` = dragged below full; the tap-catcher then passes touches through.
  const [lowered, setLowered] = React.useState(false);
  // `pillMode` = at the min detent; inner glass pill hidden, composer fills width.
  const [pillMode, setPillMode] = React.useState(false);
  const grow = useSharedValue(0);
  const dragY = useSharedValue(0); // 0 = full height; positive = top lowered
  const dragStart = useSharedValue(0);
  // True from the moment a resize drag touches down until it finalizes — the
  // composer's swipe-down-to-dismiss gesture ignores its end while this is set,
  // so lowering the window can never also dismiss the keyboard.
  const resizing = useSharedValue(false);

  // Grow + fade IN on mount, on the next frame — starting the timing mid-mount /
  // mid-glass-init dropped the first frames (the entrance jitter).
  React.useEffect(() => {
    grow.value = 0;
    dragY.value = 0;
    const id = requestAnimationFrame(() => {
      grow.value = withTiming(1, { duration: ANIM_MS, easing: Easing.out(Easing.cubic) });
      setEntered(true);
    });
    return () => cancelAnimationFrame(id);
  }, [grow, dragY]);

  // Exit when closed: fade + shrink out, then unmount via onClosed.
  React.useEffect(() => {
    if (isOpen) return undefined;
    Keyboard.dismiss();
    setEntered(false);
    grow.value = withTiming(0, { duration: ANIM_MS, easing: Easing.in(Easing.cubic) });
    const t = setTimeout(onClosed, ANIM_MS + 40);
    return () => clearTimeout(t);
  }, [isOpen, onClosed, grow]);

  // Drag the top bar down to lower the window (revealing what's behind), snapping
  // to detents like an iOS sheet — but anchored above the keyboard, not the very
  // bottom. `dragY` (px the top is lowered) is added to the window's top.
  const topInset = insets.top;
  const bottomInset = insets.bottom;
  const drag = React.useMemo(
    () =>
      Gesture.Pan()
        .onBegin(() => {
          resizing.value = true;
        })
        .onStart(() => {
          dragStart.value = dragY.value;
        })
        .onUpdate((e) => {
          const fullTop = topInset + MARGIN;
          const bottom = Math.max(kbHeight.value, bottomInset) + MARGIN;
          const maxDrag = Math.max(screenH - fullTop - bottom - MIN_HEIGHT, 0);
          // Allow pulling a bit past the last detent into a dismiss zone.
          const limit = maxDrag + DISMISS_ZONE;
          const next = dragStart.value + e.translationY;
          dragY.value = next < 0 ? 0 : next > limit ? limit : next;
        })
        .onEnd((e) => {
          const fullTop = topInset + MARGIN;
          const bottom = Math.max(kbHeight.value, bottomInset) + MARGIN;
          const maxDrag = Math.max(screenH - fullTop - bottom - MIN_HEIGHT, 0);
          // Flung down hard, or released past the last detent → dismiss.
          if (e.velocityY > FLING_VELOCITY || dragY.value > maxDrag + DISMISS_MARGIN) {
            runOnJS(close)();
            return;
          }
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
          runOnJS(setPillMode)(maxDrag > 0 && target >= maxDrag - 4);
        })
        .onFinalize(() => {
          resizing.value = false;
        }),
    [screenH, topInset, bottomInset, dragY, dragStart, resizing, kbHeight, close],
  );

  // Swipe DOWN on the composer pill to dismiss the keyboard (the window then
  // expands into the freed space). Only a clear downward drag activates it, so
  // taps/typing on the input and the +/send chips are unaffected.
  // NB: call a plain JS callback via runOnJS — referencing `Keyboard.dismiss`
  // inside the worklet captures RN's Keyboard (a KeyboardImpl), which the worklets
  // runtime can't serialize and crashes on attach.
  const dismissKeyboard = React.useCallback(() => {
    Keyboard.dismiss();
  }, []);
  const dismissKb = React.useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetY(14)
        .failOffsetY(-14)
        .onEnd((e) => {
          // Never dismiss while the window is being resized — a downward resize
          // drag must not double as a keyboard-dismiss swipe.
          if (resizing.value) return;
          if (e.translationY > 24 || e.velocityY > 600) {
            runOnJS(dismissKeyboard)();
          }
        }),
    [dismissKeyboard, resizing],
  );

  // Grows via LAYOUT (animating `top`), never a transform — a transform/opacity
  // would composite the subtree and stop the glass rendering. Full width the whole
  // time (left/right fixed); the bottom is anchored at the keyboard, and the top
  // animates from the bottom edge (0 height) up to the full top — so the window
  // unfolds upward from the bottom.
  const windowStyle = useAnimatedStyle(() => {
    const fullTop = insets.top + MARGIN;
    const bottom = Math.max(kbHeight.value, insets.bottom) + MARGIN;
    const collapsedTop = screenH - bottom; // sitting on its own bottom edge = 0 height
    return {
      top: collapsedTop + (fullTop - collapsedTop) * grow.value + dragY.value,
      left: MARGIN,
      right: MARGIN,
      bottom,
    };
  });

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
            {/* Drag bar — pull down to lower the window to a detent (see behind).
             * At the pill (min) detent the grabber overlays the top of the composer
             * (absolute, zero layout height) so the window collapses to a true pill
             * shape instead of stacking grabber-above-composer into a tall rect. */}
            <GestureDetector gesture={drag}>
              <View style={[styles.grabberArea, pillMode && styles.grabberAreaPill]}>
                <View style={styles.grabber} />
              </View>
            </GestureDetector>

            {/* Conversation area — empty for now; flexes so the composer pill sits
             * at the bottom of the window. Hidden in pill mode. */}
            {pillMode ? null : <View style={styles.conversationArea} />}

            {/* Glass-in-glass: a `regular` glass composer pill inside the clear
             * window — the bottom-bar design: (+) | input | (send). At the pill
             * (min) detent the composer fills the window and its glass goes "clear"
             * so it blends into the clear window (no visible pill-in-pill). It must
             * NOT switch to "none": that swaps the native view type, remounting the
             * focused TextInput inside it and dropping the keyboard the instant we
             * reach the min detent. "clear" keeps the same effect view. */}
            <View style={[styles.pillWrap, pillMode && styles.pillWrapFill]}>
              <GestureDetector gesture={dismissKb}>
                <GlassView
                  style={[styles.pill, pillMode && styles.pillFill]}
                  glassEffectStyle={pillMode ? "clear" : "regular"}
                  colorScheme={scheme === "dark" ? "dark" : "light"}
                >
                  <Pressable style={styles.plusChip} hitSlop={6} accessibilityRole="button" accessibilityLabel="Add">
                    <Ionicons name="add" size={22} color={colors.secondaryLabel} />
                  </Pressable>
                  <TextInput
                    style={styles.pillInput}
                    value={text}
                    onChangeText={setText}
                    placeholder={`Ask ${AGENT_NAME}…`}
                    placeholderTextColor={colors.placeholderText}
                    autoFocus
                    multiline
                  />
                  <Pressable
                    style={[styles.sendChip, { backgroundColor: text.trim().length > 0 ? themeColors.secondary : themeColors.secondaryFill }]}
                    hitSlop={6}
                    accessibilityRole="button"
                    accessibilityLabel="Send"
                    onPress={() => setText("")}
                  >
                    <Ionicons name="arrow-up" size={18} color="#FFFFFF" />
                  </Pressable>
                </GlassView>
              </GestureDetector>
            </View>
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
  // Pill (min) detent only: lift the grabber out of layout flow and float it over
  // the composer's top edge, so it adds no height and the window is a true pill.
  grabberAreaPill: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: GRABBER_AREA_H,
    zIndex: 2,
  },
  grabber: {
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: "rgba(120,120,128,0.55)",
  },
  conversationArea: {
    flex: 1,
  },
  // Margins around the inner composer pill (glass within the window glass).
  pillWrap: {
    paddingHorizontal: 12,
    paddingBottom: 12,
  },
  // Pill mode: no margins, fill the window so the composer spans the full width.
  pillWrapFill: {
    flex: 1,
    paddingHorizontal: 0,
    paddingBottom: 0,
  },
  pillFill: {
    flex: 1,
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 52,
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderRadius: 26,
    borderCurve: "continuous",
  },
  plusChip: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(120,120,128,0.28)",
  },
  pillInput: {
    flex: 1,
    color: colors.label,
    fontSize: 16,
    maxHeight: 100,
    paddingVertical: 6,
    paddingHorizontal: 2,
  },
  sendChip: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
});
