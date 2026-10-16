/**
 * The window that grows up out of the bottom bar: Dubz's, and the model
 * picker's. One component with two states, animated between, never swapped:
 * - **collapsed**: the bar's pill, in the bar's spot;
 * - **expanded**: the window. It grows up out of the pill to its requested
 *   height; the pill stays at its bottom, inset, as the window's input.
 *
 * The height model (barWindowGeometry.ts is the math):
 * - The owner gives a REQUESTED height. The window renders it CLAMPED to the
 *   space above the keyboard (`clampRequested`). The keyboard only moves the
 *   clamp — it never changes the request — so the window stays above the
 *   keyboard and returns to its full height when the keyboard goes.
 * - Drag the grab handle to resize. A release rests anywhere between
 *   `minOpenHeight` and the top (Dubz, `freeAbove`), or snaps to the nearer of
 *   those two anchors (the model picker). A drag below `minOpenHeight`, or a
 *   fling down, dismisses.
 *
 * It sits where the bar does, so it rides the keyboard as the bar does.
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
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { COMPOSER_FIELD_PADDING } from "./composerBarSpec";
import { BAR_GAP, type BarWindowState, clampRequested, maxHeightFor as geometryMaxHeight, MIN_HEIGHT, sameBarWindowState, type ScreenFrame, snapOpenHeight } from "./dubz/barWindowGeometry";
import { forgetBarWindow, settleBarWindow } from "./dubz/useBarWindow";
import { useKeyboardHeightValue } from "./keyboardHeight";
import { useKeyboardHeight } from "./useKeyboardHeight";

/** The window's resize gesture, offered to the body so a consumer can drive the
 * resize from its own handle (Dubz's title pill) when `grabberHidden`. */
export const BarWindowResizeContext = React.createContext<GestureType | undefined>(undefined);

/** The window's live visible height (pt), offered to the body so a consumer can
 * react to it (Dubz's compact mode) without owning the height itself. */
export const BarWindowHeightContext = React.createContext<Readonly<SharedValue<number>> | undefined>(undefined);

/** The bar's side inset (BottomBar's), and so the window's. */
const MARGIN = 12;
/** Corner radius of the window, and of the pill (the bar's). */
export const WINDOW_RADIUS = 30;
/** Grow/shrink duration (ms) for opening and collapsing. */
const ANIM_MS = 220;
/** The window's glass fades in over the first ~55% of the grow: native
 * glassEffectStyle `animate` (seconds), the only opacity-free way to fade
 * glass. */
const FADE_S = (ANIM_MS * 0.55) / 1000;
/** The pill's inset inside the expanded window; none collapsed. */
const COMPOSER_INSET = 12;
/** Height range (above the pill) over which the pill's inset closes, so it eases
 * into the bar instead of snapping as the window shrinks toward the pill. */
const COMPOSER_INSET_RANGE = 110;
/** The pill's padding: the bar's collapsed; a little tighter expanded (the
 * window's input). */
const PILL_PAD_V_EXPANDED = 7;
const PILL_PAD_H_EXPANDED = 8;
/** The handle's top (a line just inside the window top: its 10pt top padding
 * puts the line 7pt down). */
const GRABBER_TOP_EXPANDED = -3;
/** Below the handle's line (7pt down, 5pt tall), the space before the
 * window's content: where a body's content starts. */
export const HANDLE_CLEARANCE = GRABBER_TOP_EXPANDED + 10 + 5 + 18;
/** Snap-to-rest duration on drag release. */
const SNAP_MS = 240;
/** Fling-down velocity (px/s) that collapses the window. */
const FLING_VELOCITY = 1400;
/** How far below the lowest anchor the window can be pulled (it gives less the
 * farther it goes, never reaching this), and the release point past which
 * (lowest anchor − margin) it dismisses instead of snapping back. */
const DISMISS_ZONE = 120;
const DISMISS_MARGIN = 48;
/** The pull's resistance below the lowest anchor (iOS's rubber band is 0.55). */
const RUBBER_BAND = 0.55;
/** A release's momentum, folded into where it is heading. */
const PROJECT = 0.08;

const SNAP_EASING = Easing.out(Easing.cubic);

/** Why the window closed: a tap outside, a fling, or a drag below the lowest
 * anchor. */
export type CloseReason = "keyboard" | "dismiss";

export interface BarWindowProps {
  readonly open: boolean;
  /** Open or collapse without the grow (a page slid in, or away). */
  readonly instant: boolean;
  readonly onClose: (reason: CloseReason) => void;
  /** Focused once it starts to open; blurred as it closes. */
  readonly inputRef: React.RefObject<TextInput | null>;
  /** The window's glass while open. */
  readonly glass: "clear" | "regular";
  /** Tints the window's glass material. */
  readonly tintColor?: string;
  /** The height the window wants (pt, from the pill up). Rendered clamped to the
   * space above the keyboard; the keyboard never changes it. */
  readonly requestedHeight: number;
  /** The lowest open rest height — one suggestion for Dubz, the stop for the
   * model picker. A drag below it dismisses. */
  readonly minOpenHeight: number;
  /** Rest anywhere between `minOpenHeight` and the max (Dubz), or snap to the
   * nearer of those two anchors (the model picker). */
  readonly freeAbove: boolean;
  /** A drag settled at this height — the owner updates its requested height. */
  readonly onResize: (height: number) => void;
  /** The keyboard settled up (`true`) or down (`false`), on willShow/willHide. */
  readonly onKeyboardSettle?: (up: boolean) => void;
  /** Out of sight collapsed (it is not the bar itself): parked off-screen,
   * still mounted, so opening never builds its contents. */
  readonly hiddenCollapsed?: boolean;
  /** The tap-outside catcher's label. */
  readonly closeLabel: string;
  /** Whether a tap outside the window closes it (and blocks the content behind).
   * Off for Dubz, so the page behind stays interactive with Dubz open. Default
   * true. */
  readonly dismissOnTapOutside?: boolean;
  /** Above the pill, cropped to the window. */
  readonly body: React.ReactNode;
  /** The pill's row, on its glass. */
  readonly pill: React.ReactNode;
  /** Covers the window's body (never the grab bar): Dubz's page swipe. */
  readonly bodyGesture?: GestureType;
  /** Hide the default top grab handle. A consumer then drives the resize from
   * its own control via the resize gesture (BarWindowResizeContext) — Dubz's
   * sub-pages move the grabber onto their title pill. */
  readonly grabberHidden?: boolean;
  /** The navigation route this window is on. Given it, the window reports its
   * settled state to the BarWindowStore (keyed by it) so the screen's scroll
   * views can pad for it, and forgets it on unmount. Omitted (e.g. the model
   * picker) means the window doesn't report. */
  readonly routeKey?: string;
  /** The pill floats over the body (which then fills the window), lowered by
   * this much (pt; 0 in place) — the model window slides it away as its list
   * scrolls. */
  readonly pillLowered?: SharedValue<number>;
  /** The composer input's live height (pt), ≥ MIN_HEIGHT — the collapsed bar
   * grows with it so a multi-line input is never clipped over the glass. Dubz
   * passes it; others omit it (the floor stays the one-line pill). */
  readonly composerFloor?: SharedValue<number>;
  /** Hidden collapsed: the collapse has finished and it is out of sight. */
  readonly onHidden?: () => void;
  /** Whether opening raises the keyboard (focuses the field). Default true;
   * false focuses only when the keyboard is already up — Dubz opens to its
   * suggestions without deploying the keyboard, a tap on the field raises it. */
  readonly raiseKeyboardOnOpen?: boolean;
}

/** How near the pill a height is, over the inset range: 0 above it, 1 at the
 * pill. The pill's inset and padding follow it, so it is the bar at 1. */
const pillProgress = (visible: number): number => {
  "worklet";
  const over = visible - MIN_HEIGHT;
  return over >= COMPOSER_INSET_RANGE ? 0 : over <= 0 ? 1 : 1 - over / COMPOSER_INSET_RANGE;
};

export const BarWindow = (props: BarWindowProps): React.ReactElement => {
  const { open, instant, onClose, inputRef, requestedHeight, minOpenHeight, freeAbove } = props;
  const raiseKeyboardOnOpen = props.raiseKeyboardOnOpen ?? true;
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const scheme = useColorScheme();
  const glassScheme = scheme === "dark" ? "dark" : "light";
  // The app's one keyboard tracker (keyboardHeight.tsx): the live height for the
  // per-frame clamp.
  const kbHeight = useKeyboardHeightValue();
  // The keyboard's settled height (JS, on willShow/Hide): what this window
  // reports to the store, and tells the owner (so it can track it, never per
  // frame).
  const keyboardHeight = useKeyboardHeight();
  const { height: screenH, width: screenW } = useWindowDimensions();
  // The screen the window sits in; the geometry (barWindowGeometry.ts) is pure
  // over it. Memoised so the worklets below stay stable (a fresh frame each
  // render would rebuild the animated styles and hitch the drag).
  const frame = React.useMemo<ScreenFrame>(() => ({ height: screenH, headerHeight, insetTop: insets.top, insetBottom: insets.bottom }), [screenH, headerHeight, insets.top, insets.bottom]);

  // 0 collapsed → 1 open, by layout (height), never a transform.
  const grow = useSharedValue(0);
  // The requested height the window rides. A drag writes it directly; the owner
  // writes it (a new default, an active component) through the prop effect
  // below. The renderer clamps it per frame, so the keyboard never touches it.
  const requested = useSharedValue(requestedHeight);
  // The visible height: the request clamped to the space above the keyboard,
  // computed once per frame and read by every style. The floor is the collapsed
  // bar — the composer's live height when given (so a grown input is not
  // clipped), else the one-line pill.
  const composerFloor = props.composerFloor;
  const visible = useDerivedValue(() => clampRequested(requested.value, frame, kbHeight.value, composerFloor?.value ?? MIN_HEIGHT));
  // True while a resize drag is down, so the owner's prop changes don't fight
  // the finger, and the pill's swipe-down never doubles as a resize.
  const resizing = useSharedValue(false);
  // Whether the window is settled below full — the tap-catcher passes touches
  // through when it is.
  const loweredSV = useSharedValue(false);
  const [lowered, setLowered] = React.useState(false);
  // In sight: always, unless hidden collapsed (then from opening until the
  // collapse has finished; parked off-screen otherwise).
  const [drawn, setDrawn] = React.useState(open || props.hiddenCollapsed !== true);

  const dismiss = React.useCallback(() => onClose("dismiss"), [onClose]);

  // Report the window's SETTLED state to the store, keyed by route, when it
  // changes — on open/close, a snap and a keyboard settle. Only when it actually
  // changed; never per frame. The settled visible height is the request clamped
  // for the settled keyboard.
  const { routeKey } = props;
  const lastReported = React.useRef<BarWindowState | undefined>(undefined);
  const report = React.useCallback(() => {
    if (routeKey === undefined) return;
    const height = open ? clampRequested(requestedHeight, frame, keyboardHeight) : MIN_HEIGHT;
    const next: BarWindowState = { open, height, keyboard: keyboardHeight };
    if (lastReported.current !== undefined && sameBarWindowState(lastReported.current, next)) return;
    lastReported.current = next;
    settleBarWindow(routeKey, next);
  }, [routeKey, open, keyboardHeight, requestedHeight, frame]);

  // Open and collapse, acting only on a change of `open`.
  const onHidden = props.onHidden;
  const hide = React.useCallback(() => {
    setDrawn(props.hiddenCollapsed !== true);
    onHidden?.();
  }, [props.hiddenCollapsed, onHidden]);
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
    // Land at the requested height.
    requested.value = requestedHeight;
    setLowered(requestedHeight < geometryMaxHeight(frame, keyboardHeight) - 4);
    if (instant) {
      grow.value = 1;
      if (raiseKeyboardOnOpen || Keyboard.isVisible()) inputRef.current?.focus();
      return undefined;
    }
    // On the next frame: starting mid-mount dropped the first frames.
    const raf = requestAnimationFrame(() => {
      grow.value = withTiming(1, { duration: ANIM_MS, easing: Easing.out(Easing.cubic) });
      if (raiseKeyboardOnOpen || Keyboard.isVisible()) inputRef.current?.focus();
    });
    return () => cancelAnimationFrame(raf);
  }, [open, instant, inputRef, grow, requested, requestedHeight, frame, keyboardHeight, hide, raiseKeyboardOnOpen]);

  // The owner moved the requested height while open (a new default, an active
  // component): animate to it — but never while a drag owns the height.
  React.useEffect(() => {
    if (!open || resizing.value) return;
    requested.value = withTiming(requestedHeight, { duration: SNAP_MS, easing: SNAP_EASING });
  }, [requestedHeight, open, requested, resizing]);

  // Report on open/close, a snap (from the gesture), and a keyboard settle (the
  // deps carry those changes through the callback).
  React.useEffect(() => {
    report();
  }, [report]);
  // Tell the owner the keyboard settled (so it tracks it), without re-firing on
  // unrelated renders.
  const onKeyboardSettleRef = React.useRef(props.onKeyboardSettle);
  onKeyboardSettleRef.current = props.onKeyboardSettle;
  React.useEffect(() => {
    onKeyboardSettleRef.current?.(keyboardHeight > 0);
  }, [keyboardHeight]);
  // Drop this route when the window unmounts.
  React.useEffect(
    () => () => {
      if (routeKey !== undefined) forgetBarWindow(routeKey);
    },
    [routeKey],
  );

  // Drag the handle to resize, in visible-height points, anchored on the bar.
  const onResize = props.onResize;
  const dragStart = useSharedValue(0);
  const drag = React.useMemo(
    () =>
      Gesture.Pan()
        .onBegin(() => {
          resizing.value = true;
        })
        .onStart(() => {
          dragStart.value = visible.value;
        })
        .onUpdate((e) => {
          const max = geometryMaxHeight(frame, kbHeight.value);
          // The lowest rest: the pill (the bar) for Dubz, the stop otherwise.
          const floor = freeAbove ? MIN_HEIGHT : minOpenHeight;
          // The finger lifts the top: height grows as it moves up.
          let next = dragStart.value - e.translationY;
          if (next > max) next = max;
          // Below the lowest rest it gives less and less, like iOS's rubber
          // band, toward the dismiss.
          if (next < floor) {
            const below = floor - next;
            next = floor - DISMISS_ZONE * (1 - 1 / ((below * RUBBER_BAND) / DISMISS_ZONE + 1));
          }
          requested.value = next;
          const low = next < max - 4;
          if (low !== loweredSV.value) {
            loweredSV.value = low;
            runOnJS(setLowered)(low);
          }
        })
        .onEnd((e) => {
          const max = geometryMaxHeight(frame, kbHeight.value);
          const floor = freeAbove ? MIN_HEIGHT : minOpenHeight;
          // Flung down hard, or released below the lowest rest → dismiss.
          if (e.velocityY > FLING_VELOCITY || requested.value < floor - DISMISS_MARGIN) {
            runOnJS(dismiss)();
            return;
          }
          const projected = requested.value - e.velocityY * PROJECT;
          const snapped = snapOpenHeight(requested.value, projected, minOpenHeight, max, freeAbove);
          requested.value = withTiming(snapped, { duration: SNAP_MS, easing: SNAP_EASING });
          const low = snapped < max - 4;
          loweredSV.value = low;
          runOnJS(setLowered)(low);
          runOnJS(onResize)(snapped);
          runOnJS(report)();
        })
        .onFinalize(() => {
          resizing.value = false;
        }),
    [frame, minOpenHeight, freeAbove, requested, visible, dragStart, resizing, loweredSV, kbHeight, dismiss, onResize, report],
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

  // The window's height: the bar's collapsed, growing to the visible height
  // open. Computed right here, from shared values only (a helper made fresh each
  // render made Reanimated rebuild the style every render and hitched the drag).
  const windowStyle = useAnimatedStyle(() => {
    const floor = composerFloor?.value ?? MIN_HEIGHT;
    return { height: floor + (visible.value - floor) * grow.value };
  });

  // The pill's inset and padding follow how open the window reads: the bar at 0
  // (the pill fills it), the window's input at 1.
  const inPlace = useSharedValue(0);
  const pillDrop = props.pillLowered ?? inPlace;
  const pillWrapStyle = useAnimatedStyle(() => {
    const openness = grow.value * (1 - pillProgress(visible.value));
    return {
      paddingHorizontal: COMPOSER_INSET * openness,
      paddingBottom: COMPOSER_INSET * openness,
      // Floating, lowered by layout (a transform on glass stops it rendering).
      bottom: -pillDrop.value,
    };
  });
  const pillStyle = useAnimatedStyle(() => {
    const openness = grow.value * (1 - pillProgress(visible.value));
    return {
      paddingVertical: COMPOSER_FIELD_PADDING + (PILL_PAD_V_EXPANDED - COMPOSER_FIELD_PADDING) * openness,
      paddingHorizontal: COMPOSER_FIELD_PADDING + (PILL_PAD_H_EXPANDED - COMPOSER_FIELD_PADDING) * openness,
    };
  });

  // The handle: a plain line (not glass), so it may fade with the grow.
  const handleStyle = useAnimatedStyle(() => ({ opacity: grow.value }));

  const content = (
    <View style={styles.fill}>
      <GlassContainer style={styles.fill}>
        <GlassView
          style={styles.glass}
          // The window's glass while open; none collapsed, where the pill fills
          // it and is the bar. Faded by the native animate, never opacity.
          glassEffectStyle={{ style: open ? props.glass : "none", animate: true, animationDuration: FADE_S }}
          tintColor={props.tintColor}
          colorScheme={glassScheme}
        >
          {/* The space above the pill, which alone is cropped (no glass in it;
           * nothing above the pill's glass ever clips it). */}
          <View style={props.pillLowered !== undefined ? styles.bodyUnder : styles.body} pointerEvents={open ? "box-none" : "none"}>
            {/* Offer the resize gesture to the body's own control only when the
             * top grabber is hidden — never both, or `drag` would be attached to
             * two detectors at once. */}
            <BarWindowHeightContext.Provider value={visible}>
              <BarWindowResizeContext.Provider value={props.grabberHidden === true ? drag : undefined}>{props.body}</BarWindowResizeContext.Provider>
            </BarWindowHeightContext.Provider>
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
       * to what's behind). Off when `dismissOnTapOutside` is false (Dubz). */}
      {open && !lowered && props.dismissOnTapOutside !== false ? (
        <Pressable style={StyleSheet.absoluteFill} onPress={dismiss} accessibilityRole="button" accessibilityLabel={props.closeLabel} />
      ) : null}

      <Reanimated.View style={[styles.window, windowStyle]}>
        {/* The body's gesture covers the window's body only, never the grab
         * bar: over the bar it competed with the resize drag. */}
        {props.bodyGesture !== undefined ? <GestureDetector gesture={props.bodyGesture}>{content}</GestureDetector> : content}

        {/* The grab handle: a line inside the window top; gone collapsed. Hidden
         * when a consumer moves it onto its own control (Dubz's title pill). */}
        {props.grabberHidden === true ? null : (
          <GestureDetector gesture={drag}>
            <Reanimated.View style={[styles.grabHandle, handleStyle]} pointerEvents={open ? "auto" : "none"}>
              <View style={styles.grabber} />
            </Reanimated.View>
          </GestureDetector>
        )}
      </Reanimated.View>
    </View>
  );
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
  grabHandle: {
    position: "absolute",
    alignSelf: "center",
    top: GRABBER_TOP_EXPANDED,
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
