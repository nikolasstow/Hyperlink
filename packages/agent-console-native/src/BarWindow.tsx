/**
 * The window that grows up out of the bottom bar: Dubz's, and the model
 * picker's. One component with two states, animated between, never swapped:
 * - **collapsed**: the bar's pill, in the bar's spot;
 * - **expanded**: the window. It grows up out of the pill to its detent; the
 *   pill stays at its bottom, inset, as the window's input. Its own glass comes
 *   in above the smallest detent; at the smallest it has none, and the pill
 *   fills it, so there it is the bar again (with a grab handle while the
 *   keyboard is up; the keyboard going down there closes it).
 *
 * It sits where the bar does, so it rides the keyboard as the bar does. Drag
 * the handle to resize (full, half, the pill), fling or drag it down past the
 * pill to close, tap outside at full height to close.
 *
 * Glass invariants (learned the hard way):
 * - Round the GlassView via `borderRadius` on the GlassView itself (native
 *   UIGlassEffect corner config); never clip it with an `overflow: hidden`
 *   parent — that crops the material.
 * - Never animate opacity or a transform on a GlassView or its parents (it
 *   stops rendering glass). Motion here is layout (`height`, padding); glass
 *   comes and goes by the native `glassEffectStyle` fade, never by opacity.
 *
 * @internal
 */
import { useHeaderHeight } from "@react-navigation/elements";
import { GlassContainer, GlassView } from "expo-glass-effect";
import * as React from "react";
import { Keyboard, Pressable, StyleSheet, type TextInput, useColorScheme, useWindowDimensions, View } from "react-native";
import { Gesture, GestureDetector, type GestureType } from "react-native-gesture-handler";
import Reanimated, {
  Easing,
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { COMPOSER_FIELD_PADDING, COMPOSER_PILL_HEIGHT } from "./composerBarSpec";
import { useKeyboardHeightValue } from "./keyboardHeight";
import { composerRestingBottom } from "./useKeyboardSlide";

/** The bar's side inset (BottomBar's), and so the window's. */
const MARGIN = 12;
/** The bottom bar's gap under its pill (BottomBar's bottom padding). */
const BAR_GAP = 8;
/** The collapsed height: the bar's pill, and the smallest detent. */
const MIN_HEIGHT = COMPOSER_PILL_HEIGHT;
/** Gap between the window's top and the header at full height. */
const TOP_GAP = 8;
/** Corner radius of the window, and of the pill (the bar's). */
export const WINDOW_RADIUS = 30;
/** Grow/shrink duration (ms) for opening and collapsing. */
const ANIM_MS = 320;
/** The window's glass fades in over the first ~55% of the grow: native
 * glassEffectStyle `animate` (seconds), the only opacity-free way to fade
 * glass. */
const FADE_S = (ANIM_MS * 0.55) / 1000;
/** The pill's inset inside the expanded window; none collapsed. */
const COMPOSER_INSET = 12;
/** Drag distance (px before the smallest detent) over which the pill's inset
 * closes, so it eases into the bar instead of snapping. */
const COMPOSER_INSET_RANGE = 110;
/** The pill's padding: the bar's collapsed; a little tighter expanded (the
 * window's input). */
const PILL_PAD_V_EXPANDED = 7;
const PILL_PAD_H_EXPANDED = 8;
/** The handle's top at larger detents (a line just inside the window top: its
 * 10pt top padding puts the line 7pt down). */
const GRABBER_TOP_EXPANDED = -3;
/** Below the handle's line (7pt down, 5pt tall), the space before the
 * window's content: where a body's content starts. */
export const HANDLE_CLEARANCE = GRABBER_TOP_EXPANDED + 10 + 5 + 18;
/** The handle lifts to this (above the pill) at the smallest detent, over the
 * glass tab. */
const TAB_TOP = -24;
/** Snap-to-detent duration on drag release. */
const SNAP_MS = 240;
/** Fling-down velocity (px/s) that collapses the window. */
const FLING_VELOCITY = 1400;
/** How far past the lowest detent the window can be pulled (it gives less the
 * farther it goes, never reaching this), and the release point past which
 * (lowest detent + margin) it collapses instead of snapping back. */
const DISMISS_ZONE = 120;
const DISMISS_MARGIN = 48;
/** The pull's resistance past the lowest detent (iOS's rubber band is 0.55). */
const RUBBER_BAND = 0.55;

/** Where a window opens, and keeping where a drag leaves it: a fraction of the
 * drag range (0 = full, 0.5 = half, 1 = the smallest) plus the keyboard height
 * then, so an open sizes the detent before the keyboard settles. */
export interface DetentMemory {
  readonly frac: () => number;
  readonly kbFull: () => number;
  readonly remember: (frac: number, kbFull: number) => void;
}

/** Why the window closed: the keyboard went down at the smallest detent, or it
 * was dismissed (tap outside, fling, dragged away). */
export type CloseReason = "keyboard" | "dismiss";

export interface BarWindowProps {
  readonly open: boolean;
  /** Open or collapse without the grow (a page slid in, or away). */
  readonly instant: boolean;
  readonly onClose: (reason: CloseReason) => void;
  /** Focused once it starts to open; blurred as it closes. */
  readonly inputRef: React.RefObject<TextInput | null>;
  /** The window's glass above the smallest detent. */
  readonly glass: "clear" | "regular";
  /** Tints the window's glass material. */
  readonly tintColor?: string;
  readonly detent: DetentMemory;
  /** Out of sight collapsed (it is not the bar itself): parked off-screen,
   * still mounted, so opening never builds its contents. */
  readonly hiddenCollapsed?: boolean;
  /** The tap-outside catcher's label. */
  readonly closeLabel: string;
  /** Above the pill, cropped to the window. */
  readonly body: React.ReactNode;
  /** The pill's row, on its glass. */
  readonly pill: React.ReactNode;
  /** Covers the window's body (never the grab bar): Dubz's page swipe. */
  readonly bodyGesture?: GestureType;
  /** One stop below full, as a window height (pt), in place of half and the
   * pill: the window then rests at full or at this height, whatever the
   * keyboard does. */
  readonly stop?: number;
  /** The pill floats over the body (which then fills the window), lowered by
   * this much (pt; 0 in place) — the model window slides it away as its list
   * scrolls. */
  readonly pillLowered?: SharedValue<number>;
}

const atPillFrac = (frac: number): boolean => frac >= 0.98;

/** Clamp to [0, 1]. */
const unit = (value: number): number => {
  "worklet";
  return value < 0 ? 0 : value > 1 ? 1 : value;
};

/** How near the smallest detent a drag is: 0 above the pill's inset range, 1
 * at it. */
const pillProgress = (drag: number, maxDrag: number): number => {
  "worklet";
  const start = Math.max(maxDrag - COMPOSER_INSET_RANGE, 0);
  const span = maxDrag - start;
  return span <= 0 ? 0 : unit((drag - start) / span);
};

// DIAG(model-perf): renders since last read; remove once found.
let renders = 0;
export const barWindowRenders = (): number => {
  const count = renders;
  renders = 0;
  return count;
};

export const BarWindow = (props: BarWindowProps): React.ReactElement => {
  renders += 1;
  const { open, instant, onClose, inputRef, detent, stop } = props;
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const scheme = useColorScheme();
  const glassScheme = scheme === "dark" ? "dark" : "light";
  // The app's one keyboard tracker (keyboardHeight.tsx).
  const kbHeight = useKeyboardHeightValue();
  const { height: screenH, width: screenW } = useWindowDimensions();
  const resting = composerRestingBottom(insets.bottom);
  const windowTop = Math.max(headerHeight, insets.top) + TOP_GAP;

  // `lowered` = below full; the tap-catcher then passes touches through.
  // `pillMode` = settled at the smallest detent (the handle's place follows it,
  // on release). `abovePill` = off the smallest detent right now, live during
  // a drag, so the window's glass comes in as it leaves the pill rather than
  // when the drag is let go.
  const [lowered, setLowered] = React.useState(() => detent.frac() > 0.02);
  const [pillMode, setPillMode] = React.useState(() => atPillFrac(detent.frac()));
  const [abovePill, setAbovePill] = React.useState(() => !atPillFrac(detent.frac()));
  // In sight: always, unless hidden collapsed (then from opening until the
  // collapse has finished; parked off-screen otherwise).
  const [drawn, setDrawn] = React.useState(open || props.hiddenCollapsed !== true);
  const abovePillNow = useSharedValue(!atPillFrac(detent.frac()));
  // 0 collapsed → 1 open, by layout (height), never a transform.
  const grow = useSharedValue(0);
  // How far the top is lowered from full height.
  const dragY = useSharedValue(0);
  const dragStart = useSharedValue(0);
  // The full keyboard height, the running max of the live height: the window's
  // height is computed from it, so the detents are the same with the keyboard
  // up or down (the window just rides down with the bar when it goes).
  const kbFull = useSharedValue(detent.kbFull());
  // The handle: 0 = a line inside the window top, 1 = lifted over the glass tab.
  const handleT = useSharedValue(atPillFrac(detent.frac()) ? 1 : 0);
  // True while a resize drag is down, so the pill's swipe-down (keyboard
  // dismiss) never doubles as one.
  const resizing = useSharedValue(false);

  /** The drag range for a keyboard height: full height down to the pill. */
  const maxDragFor = React.useCallback(
    (kb: number): number => {
      "worklet";
      return Math.max(screenH - windowTop - (Math.max(kb, resting) + BAR_GAP) - MIN_HEIGHT, 0);
    },
    [screenH, windowTop, resting],
  );

  /** With a stop: how far the top is lowered from full to rest there. */
  const stopDragFor = React.useCallback(
    (maxDrag: number): number => {
      "worklet";
      return stop === undefined ? maxDrag : Math.max(maxDrag + MIN_HEIGHT - stop, 0);
    },
    [stop],
  );
  // Resting at the stop: kept there, in points, as the keyboard's height moves
  // the drag range.
  const atStop = useSharedValue(false);

  const dismiss = React.useCallback(() => onClose("dismiss"), [onClose]);

  // The keyboard going down at the smallest detent closes it: it is the bar
  // with a handle, and without the keyboard just the bar.
  const openNow = React.useRef(open);
  const pillNow = React.useRef(pillMode);
  React.useEffect(() => {
    openNow.current = open;
    pillNow.current = pillMode;
  }, [open, pillMode]);
  const keyboardDown = React.useCallback(() => {
    if (openNow.current && pillNow.current) onClose("keyboard");
  }, [onClose]);
  useAnimatedReaction(
    () => kbHeight.value,
    (h, previous) => {
      if (h > kbFull.value) {
        kbFull.value = h;
        if (atStop.value) dragY.value = stopDragFor(maxDragFor(h));
      }
      if (h === 0 && previous !== null && previous > 0) runOnJS(keyboardDown)();
    },
  );

  // Open and collapse, acting only on a change of `open`.
  const hide = React.useCallback(() => setDrawn(props.hiddenCollapsed !== true), [props.hiddenCollapsed]);
  const wasOpen = React.useRef(open);
  React.useEffect(() => {
    if (wasOpen.current === open) return undefined;
    wasOpen.current = open;
    if (!open) {
      if (inputRef.current?.isFocused() === true) inputRef.current.blur();
      if (instant) {
        grow.value = 0;
        hide();
        return undefined;
      }
      grow.value = withTiming(0, { duration: ANIM_MS, easing: Easing.in(Easing.cubic) }, (finished) => {
        if (finished === true) runOnJS(hide)();
      });
      return undefined;
    }
    setDrawn(true);
    // Land at the detent last left, sized from the keyboard height then (the
    // keyboard may not be up yet).
    const frac = detent.frac();
    // With a stop, never the pill: full, or the stop.
    const pill = stop === undefined && atPillFrac(frac);
    kbFull.value = Math.max(kbFull.value, detent.kbFull());
    const resting = stop !== undefined && frac > 0.02;
    atStop.value = resting;
    dragY.value = stop === undefined ? frac * maxDragFor(detent.kbFull()) : resting ? stopDragFor(maxDragFor(kbFull.value)) : 0;
    handleT.value = pill ? 1 : 0;
    abovePillNow.value = !pill;
    setLowered(frac > 0.02);
    setPillMode(pill);
    setAbovePill(!pill);
    if (instant) {
      grow.value = 1;
      return undefined;
    }
    // On the next frame: starting mid-mount dropped the first frames.
    const frame = requestAnimationFrame(() => {
      grow.value = withTiming(1, { duration: ANIM_MS, easing: Easing.out(Easing.cubic) });
      inputRef.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [open, instant, inputRef, grow, dragY, kbFull, handleT, abovePillNow, maxDragFor, stopDragFor, stop, atStop, detent, hide]);

  // Slide the handle to its new spot only after a drag settles.
  React.useEffect(() => {
    handleT.value = withTiming(pillMode ? 1 : 0, { duration: SNAP_MS, easing: Easing.out(Easing.cubic) });
  }, [pillMode, handleT]);

  // Drag the handle to resize, snapping to detents like an iOS sheet, anchored
  // on the bar.
  const remember = detent.remember;
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
          const maxDrag = maxDragFor(kbFull.value);
          // Past the lowest detent it gives less and less, like iOS's rubber
          // band: never more than DISMISS_ZONE, however far the finger goes.
          const lowest = stopDragFor(maxDrag);
          const next = dragStart.value + e.translationY;
          const past = next - lowest;
          dragY.value =
            next < 0 ? 0 : past > 0 ? lowest + DISMISS_ZONE * (1 - 1 / ((past * RUBBER_BAND) / DISMISS_ZONE + 1)) : next;
          const above = stop !== undefined || dragY.value < maxDrag - 4;
          if (above !== abovePillNow.value) {
            abovePillNow.value = above;
            runOnJS(setAbovePill)(above);
          }
        })
        .onEnd((e) => {
          const maxDrag = maxDragFor(kbFull.value);
          // Flung down hard, or released past the last detent → collapse.
          if (e.velocityY > FLING_VELOCITY || dragY.value > stopDragFor(maxDrag) + DISMISS_MARGIN) {
            runOnJS(dismiss)();
            return;
          }
          const detents = stop === undefined ? [0, maxDrag * 0.5, maxDrag] : [0, stopDragFor(maxDrag)];
          const projected = dragY.value + e.velocityY * 0.08;
          let target = 0;
          let best = 1e9;
          for (const candidate of detents) {
            const diff = projected - candidate;
            const dist = diff < 0 ? -diff : diff;
            if (dist < best) {
              best = dist;
              target = candidate;
            }
          }
          dragY.value = withTiming(target, { duration: SNAP_MS, easing: Easing.out(Easing.cubic) });
          atStop.value = stop !== undefined && target > 0;
          const atPill = stop === undefined && maxDrag > 0 && target >= maxDrag - 4;
          abovePillNow.value = !atPill;
          runOnJS(setAbovePill)(!atPill);
          runOnJS(setLowered)(target > 4);
          runOnJS(setPillMode)(atPill);
          runOnJS(remember)(maxDrag > 0 ? target / maxDrag : 0, kbFull.value);
        })
        .onFinalize(() => {
          resizing.value = false;
        }),
    [dragY, dragStart, resizing, kbFull, abovePillNow, maxDragFor, stopDragFor, stop, atStop, dismiss, remember],
  );

  // Swipe DOWN on the pill to dismiss the keyboard. Only a clear downward drag
  // activates it, so taps and typing are unaffected. (A plain JS callback via
  // runOnJS: `Keyboard` itself can't be captured by a worklet.)
  const dismissKeyboard = React.useCallback(() => Keyboard.dismiss(), []);
  const dismissKb = React.useMemo(
    () =>
      Gesture.Pan()
        .enabled(open)
        .activeOffsetY(14)
        .failOffsetY(-14)
        .onEnd((e) => {
          if (resizing.value) return;
          if (e.translationY > 24 || e.velocityY > 600) runOnJS(dismissKeyboard)();
        }),
    [open, dismissKeyboard, resizing],
  );

  // The window's height: the bar's collapsed, growing to the detent open.
  // Computed right here, from shared values and the memoized maxDragFor only:
  // a helper function made fresh each render, called from this style, made
  // Reanimated rebuild the style on every re-render (the screens behind
  // re-render all the time), and every rebuild hitched the drag.
  const windowStyle = useAnimatedStyle(() => {
    const maxDrag = maxDragFor(kbFull.value);
    const height = Math.max(maxDrag + MIN_HEIGHT - dragY.value, MIN_HEIGHT);
    return { height: MIN_HEIGHT + (height - MIN_HEIGHT) * grow.value };
  });

  // How open the window reads: 0 collapsed or at the smallest detent (the
  // bar), 1 open above the pill's inset range. The pill's inset and padding
  // follow it, so it is the bar at 0 and the window's input at 1.
  const inPlace = useSharedValue(0);
  const pillDrop = props.pillLowered ?? inPlace;
  const pillWrapStyle = useAnimatedStyle(() => {
    const openness = grow.value * (1 - pillProgress(dragY.value, maxDragFor(kbFull.value)));
    return {
      paddingHorizontal: COMPOSER_INSET * openness,
      paddingBottom: COMPOSER_INSET * openness,
      // Floating, lowered by layout (a transform on glass stops it rendering).
      bottom: -pillDrop.value,
    };
  });
  const pillStyle = useAnimatedStyle(() => {
    const openness = grow.value * (1 - pillProgress(dragY.value, maxDragFor(kbFull.value)));
    return {
      paddingVertical: COMPOSER_FIELD_PADDING + (PILL_PAD_V_EXPANDED - COMPOSER_FIELD_PADDING) * openness,
      paddingHorizontal: COMPOSER_FIELD_PADDING + (PILL_PAD_H_EXPANDED - COMPOSER_FIELD_PADDING) * openness,
    };
  });

  // The handle: a plain line (not glass), so it may fade with the grow.
  const handleStyle = useAnimatedStyle(() => ({
    top: GRABBER_TOP_EXPANDED + (TAB_TOP - GRABBER_TOP_EXPANDED) * handleT.value,
    opacity: grow.value,
  }));

  const content = (
    <View style={styles.fill}>
      <GlassContainer style={styles.fill}>
        <GlassView
          style={styles.glass}
          // The window's glass while open above the smallest detent; none
          // collapsed and at the pill, where the pill fills it and is the bar.
          // Faded by the native animate, never opacity.
          glassEffectStyle={{ style: open && abovePill ? props.glass : "none", animate: true, animationDuration: FADE_S }}
          tintColor={props.tintColor}
          colorScheme={glassScheme}
        >
          {/* The space above the pill, which alone is cropped (no glass in it;
           * nothing above the pill's glass ever clips it). */}
          <View style={props.pillLowered !== undefined ? styles.bodyUnder : styles.body} pointerEvents={open ? "box-none" : "none"}>
            {props.body}
          </View>
          {/* The pill sits at the window's bottom, a direct child of the
           * window's glass: the bar collapsed, the window's input open. */}
          <Reanimated.View style={[props.pillLowered !== undefined ? styles.pillFloat : undefined, pillWrapStyle]}>
            <GestureDetector gesture={dismissKb}>
              <Reanimated.View style={[styles.pill, pillStyle]}>
                {/* The bar's regular glass, never faded (opacity on glass or
                 * its parents stops it rendering). */}
                <View style={StyleSheet.absoluteFill} pointerEvents="none">
                  <GlassView style={styles.pillGlass} glassEffectStyle="regular" colorScheme={glassScheme} />
                </View>
                {props.pill}
              </Reanimated.View>
            </GestureDetector>
          </Reanimated.View>
        </GlassView>
      </GlassContainer>
    </View>
  );

  return (
    <View style={drawn ? styles.page : [styles.parked, { width: screenW }]} pointerEvents={drawn ? "box-none" : "none"}>
      {/* Tap outside to collapse (at full height; lowered, touches pass through
       * to what's behind). Reaches up over the screen from the bar. */}
      {open && !lowered ? (
        <Pressable style={StyleSheet.absoluteFill} onPress={dismiss} accessibilityRole="button" accessibilityLabel={props.closeLabel} />
      ) : null}

      <Reanimated.View style={[styles.window, windowStyle]}>
        {/* The body's gesture covers the window's body only, never the grab
         * bar: over the bar it competed with the resize drag. */}
        {props.bodyGesture !== undefined ? <GestureDetector gesture={props.bodyGesture}>{content}</GestureDetector> : content}

        {/* Glass tab above the pill at the smallest detent, open only: it
         * comes and goes by the native animate (none ↔ regular). */}
        <View style={styles.tabGlassWrap} pointerEvents="none">
          <GlassView
            style={styles.tabGlass}
            glassEffectStyle={{ style: open && pillMode ? "regular" : "none", animate: true, animationDuration: FADE_S }}
            colorScheme={glassScheme}
          />
        </View>

        {/* The one grabber: a line inside the window top at larger detents,
         * floating over the tab at the smallest; gone collapsed. */}
        <GestureDetector gesture={drag}>
          <Reanimated.View style={[styles.grabHandle, handleStyle]} pointerEvents={open ? "auto" : "none"}>
            <View style={styles.grabber} />
          </Reanimated.View>
        </GestureDetector>
      </Reanimated.View>
    </View>
  );
};

/** A detent memory held for the app's run: `save` persists what a drag
 * leaves; `restore` puts back what was persisted (without saving it again). */
export const detentMemory = (
  initialFrac: number,
  save?: (frac: number, kbFull: number) => void,
): DetentMemory & { readonly restore: (frac: number, kbFull: number) => void } => {
  const held = {
    frac: initialFrac,
    kbFull: 0,
  };
  return {
    frac: () => held.frac,
    kbFull: () => held.kbFull,
    remember: (frac, kbFull) => {
      held.frac = frac;
      held.kbFull = kbFull;
      save?.(frac, kbFull);
    },
    restore: (frac, kbFull) => {
      held.frac = frac;
      held.kbFull = kbFull;
    },
  };
};

const styles = StyleSheet.create({
  // Fills its container, from the screen's top down to the keyboard: the
  // window grows up inside it, never past its parents' bounds (iOS delivers
  // no touch to a view outside its parent, so the grab bar was unreachable).
  page: {
    flex: 1,
  },
  // Collapsed out of sight: the page's size, off the screen's left (moved by
  // layout; a transform on glass stops it rendering).
  parked: {
    position: "absolute",
    top: 0,
    bottom: 0,
    right: "200%",
  },
  // The wrapper carries ONLY position and size — no borderRadius / overflow /
  // shadow, which would clip or composite the glass.
  window: {
    position: "absolute",
    left: MARGIN,
    right: MARGIN,
    bottom: BAR_GAP,
  },
  fill: {
    flex: 1,
    width: "100%",
    height: "100%",
  },
  // Explicit 100% size (not just flex): the native clear backdrop can't resolve
  // its bounds from flex alone. Rounding lives here, on the glass. The pill
  // sits at its bottom.
  glass: {
    width: "100%",
    height: "100%",
    borderRadius: WINDOW_RADIUS,
    justifyContent: "flex-end",
  },
  // The space above the pill, cropped to the window.
  body: {
    flex: 1,
    overflow: "hidden",
    // Cropped to the window's rounded top, not just its box.
    borderTopLeftRadius: WINDOW_RADIUS,
    borderTopRightRadius: WINDOW_RADIUS,
  },
  // The body under a floating pill: the whole window, still cropped to it.
  bodyUnder: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    overflow: "hidden",
    // Cropped to the window's rounded shape, not just its box.
    borderRadius: WINDOW_RADIUS,
  },
  // A floating pill: over the body, at the window's bottom.
  pillFloat: {
    position: "absolute",
    left: 0,
    right: 0,
  },
  tabGlassWrap: {
    position: "absolute",
    alignSelf: "center",
    top: TAB_TOP,
    zIndex: 2,
  },
  tabGlass: {
    width: 82,
    height: -TAB_TOP,
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
  },
  grabHandle: {
    position: "absolute",
    alignSelf: "center",
    width: 82,
    paddingTop: 10,
    paddingBottom: 8,
    alignItems: "center",
    zIndex: 3,
  },
  grabber: {
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: "rgba(120,120,128,0.55)",
  },
  // The pill: its row bottom-aligned so it holds its place as text grows
  // upward. The small drop shadow is the bar's (it does not clip; the glass
  // rounds itself).
  pill: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    borderRadius: WINDOW_RADIUS,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 1.5 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
  },
  pillGlass: {
    flex: 1,
    borderRadius: WINDOW_RADIUS,
  },
});
