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
import Reanimated, { Easing, runOnJS, useAnimatedKeyboard, useAnimatedReaction, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
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
/** Smallest height — the "pill" detent. A full capsule at the window radius; the
 * composer keeps its natural height and is centred within it (pillWrapFill). */
const MIN_HEIGHT = 60;
/** Composer margin inside the window (expanded); collapses to 0 at the pill. */
const COMPOSER_INSET = 12;
/** Drag distance (px before the min detent) over which the composer margins
 * collapse — the composer eases into a full pill instead of snapping. */
const COMPOSER_INSET_RANGE = 110;
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
  // The full (resting) keyboard height, tracked as the running max of the live
  // height. The window's HEIGHT is computed from this stable value while its
  // bottom edge rides the LIVE keyboard — so dismissing the keyboard keeps the
  // window's height and just drops it to the bottom of the screen (rather than
  // growing it downward), and the detents are the same with the keyboard present
  // or gone.
  const kbFull = useSharedValue(0);
  useAnimatedReaction(
    () => kbHeight.value,
    (h) => {
      if (h > kbFull.value) kbFull.value = h;
    },
  );
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
          // Height-based, from the STABLE keyboard height — so the detents are the
          // same whether the keyboard is present or gone.
          const stableBottom = Math.max(kbFull.value, bottomInset) + MARGIN;
          const maxDrag = Math.max(screenH - fullTop - stableBottom - MIN_HEIGHT, 0);
          // Allow pulling a bit past the last detent into a dismiss zone.
          const limit = maxDrag + DISMISS_ZONE;
          const next = dragStart.value + e.translationY;
          dragY.value = next < 0 ? 0 : next > limit ? limit : next;
        })
        .onEnd((e) => {
          const fullTop = topInset + MARGIN;
          const stableBottom = Math.max(kbFull.value, bottomInset) + MARGIN;
          const maxDrag = Math.max(screenH - fullTop - stableBottom - MIN_HEIGHT, 0);
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
    [screenH, topInset, bottomInset, dragY, dragStart, resizing, kbFull, close],
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
    // Bottom edge rides the LIVE keyboard (sits above it, or above the home
    // indicator when the keyboard is gone).
    const bottomEdge = screenH - (Math.max(kbHeight.value, insets.bottom) + MARGIN);
    // Expanded height is derived from the STABLE keyboard height, so it doesn't
    // change as the keyboard opens/closes — only the position (bottomEdge) does.
    const stableBottom = Math.max(kbFull.value, insets.bottom) + MARGIN;
    const fullHeight = screenH - stableBottom - fullTop;
    const height = Math.max(fullHeight * grow.value - dragY.value, 0);
    return {
      top: bottomEdge - height,
      height,
      left: MARGIN,
      right: MARGIN,
    };
  });

  // The composer's margins collapse CONTINUOUSLY as the window nears the pill
  // (min) detent, tracking the drag, so it grows into a full-width pill smoothly
  // instead of popping edge-to-edge the instant the detent latches. Only the last
  // COMPOSER_INSET_RANGE px of travel animate it; higher detents keep the margins.
  const pillPadStyle = useAnimatedStyle(() => {
    const fullTop = insets.top + MARGIN;
    const stableBottom = Math.max(kbFull.value, insets.bottom) + MARGIN;
    const maxDrag = Math.max(screenH - fullTop - stableBottom - MIN_HEIGHT, 0);
    const start = Math.max(maxDrag - COMPOSER_INSET_RANGE, 0);
    const denom = maxDrag - start;
    const raw = denom <= 0 ? 0 : (dragY.value - start) / denom;
    const p = raw < 0 ? 0 : raw > 1 ? 1 : raw;
    const pad = COMPOSER_INSET * (1 - p);
    return { paddingHorizontal: pad, paddingBottom: pad };
  });

  // The composer's frosted glass fades out over the SAME travel as the margins,
  // so the frost→clear fade rides the grow/shrink continuously (a discrete
  // glassEffectStyle switch can't be interpolated, so it never reads as a fade).
  // At the pill detent the frost is gone and the clear window shows through — no
  // visible pill-in-pill.
  const frostStyle = useAnimatedStyle(() => {
    const fullTop = insets.top + MARGIN;
    const stableBottom = Math.max(kbFull.value, insets.bottom) + MARGIN;
    const maxDrag = Math.max(screenH - fullTop - stableBottom - MIN_HEIGHT, 0);
    const start = Math.max(maxDrag - COMPOSER_INSET_RANGE, 0);
    const denom = maxDrag - start;
    const raw = denom <= 0 ? 0 : (dragY.value - start) / denom;
    const p = raw < 0 ? 0 : raw > 1 ? 1 : raw;
    return { opacity: 1 - p };
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
             * ALWAYS floats over the top (absolute, zero layout height) rather than
             * stacking above the content: that keeps the composer as the only
             * flow child, so shrinking the window toward the min never squeezes it
             * below the keyboard-anchored bottom (which collapsed the TextInput's
             * frame and dropped the keyboard), and the min detent is a true pill. */}
            <GestureDetector gesture={drag}>
              <View style={[styles.grabberArea, pillMode && styles.grabberAreaPill]}>
                <View style={styles.grabber} />
              </View>
            </GestureDetector>

            {/* Conversation area — empty for now; flexes so the composer pill sits
             * at the bottom of the window. Hidden in pill mode. */}
            {pillMode ? null : <View style={styles.conversationArea} />}

            {/* Glass-in-glass: a frosted composer pill inside the clear window —
             * the bottom-bar design: (+) | input | (send). Its margins collapse
             * continuously (pillPadStyle) toward the pill detent, and its frosted
             * background (a separate GlassView) FADES OUT over the same travel
             * (frostStyle opacity) so the frost→clear fade rides the shrink and the
             * pill blends into the clear window at the detent — no pill-in-pill. The
             * pill radius stays at the window radius in every mode, so it's a full
             * capsule throughout — no radius pop. */}
            <Reanimated.View style={[styles.pillWrap, pillMode && styles.pillWrapFill, pillPadStyle]}>
              <GestureDetector gesture={dismissKb}>
                <View style={styles.pill}>
                  {/* Frosted glass background, faded by the drag. Regular glass
                   * survives an animated-opacity layer (only CLEAR glass dies under
                   * compositing), and this is a descendant of the window glass, not
                   * an ancestor, so the window's own clear glass is unaffected. */}
                  <Reanimated.View style={[StyleSheet.absoluteFill, frostStyle]} pointerEvents="none">
                    <GlassView
                      style={styles.pillGlass}
                      glassEffectStyle="regular"
                      colorScheme={scheme === "dark" ? "dark" : "light"}
                    />
                  </Reanimated.View>
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
                </View>
              </GestureDetector>
            </Reanimated.View>
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
  // Floated out of flow (see the render note): adds no height, so the composer is
  // the only flow child and never gets squeezed as the window shrinks to the pill.
  grabberArea: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: GRABBER_AREA_H,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 2,
  },
  // Min detent: nudge the grabber up toward the top edge so it sits clear of the
  // centred composer content.
  grabberAreaPill: {
    justifyContent: "flex-start",
    paddingTop: 5,
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
  // The padding itself is animated (pillPadStyle) so it collapses smoothly toward
  // the pill detent; these are the resting/expanded values as a fallback.
  pillWrap: {
    paddingHorizontal: COMPOSER_INSET,
    paddingBottom: COMPOSER_INSET,
  },
  // Pill mode: fill the window (padding comes to 0 via the animated style) and
  // CENTRE the composer row vertically within it — the row keeps its natural
  // height rather than stretching, so bottom-aligned chips sit at the pill's
  // centre instead of low against a stretched bottom edge.
  pillWrapFill: {
    flex: 1,
    justifyContent: "center",
  },
  // The composer row. Chips ALWAYS bottom-align (so they hold position as the
  // input grows upward); the row is centred within the pill at the min detent
  // (pillWrapFill) so bottom-aligned chips read as centred there. The glass is a
  // separate faded background (pillGlass), not this view.
  pill: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    minHeight: 52,
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  // Frosted glass background of the composer. Window radius in every mode — a full
  // capsule throughout, so no radius pop, and it coincides with the window's own
  // capsule at the min detent.
  pillGlass: {
    flex: 1,
    borderRadius: WINDOW_RADIUS,
    borderCurve: "continuous",
  },
  plusChip: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    // 4px shorter than the send chip; bottom-aligned that leaves it 2px low, so
    // nudge it up by half the difference to match the send chip's centre.
    marginBottom: 2,
    backgroundColor: "rgba(120,120,128,0.28)",
  },
  pillInput: {
    flex: 1,
    color: colors.label,
    fontSize: 16,
    // Grows upward with each new line (the bottom-anchored pill grows up), capped
    // at ~8 lines — a fixed lineHeight makes that cap exact — then scrolls.
    lineHeight: 21,
    maxHeight: 21 * 8,
    // No vertical padding on the input itself — the pill's own paddingVertical is
    // the only vertical space, so the input content isn't inset from the glass edge
    // more than the chips are.
    paddingVertical: 0,
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
