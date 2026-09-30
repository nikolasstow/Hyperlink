/**
 * Dubz — the app-wide assistant, as a page of the bottom bar.
 *
 * One component with two states, animated between, never swapped:
 * - **collapsed**: the bottom bar. The same pill as the composer's collapsed
 *   bar (regular glass, `+`, a line of text, a muted send), in the same spot;
 * - **expanded**: the Dubz window. It grows up out of that bar to its detent;
 *   the bar's pill stays at its bottom, inset, as the window's composer. The
 *   window's own glass is clear; at the smallest detent it has none, and the
 *   pill fills it, so there it is the bar again (with a grab handle while the
 *   keyboard is up; the keyboard going down there collapses it).
 *
 * Where the bar is a composer (Home, a repo, a session), Composer puts this
 * page beside its own and slides between them (`pageBack` here). Where there is
 * nothing to compose (Files), `DubzBar` is the bar, with this its only page.
 *
 * Glass invariants (learned the hard way):
 * - Round the GlassView via `borderRadius` on the GlassView itself (native
 *   UIGlassEffect corner config); never clip it with an `overflow: hidden`
 *   parent — that crops the material.
 * - Never animate opacity or a transform on a GlassView or its parents (it
 *   stops rendering glass). Motion here is layout (`height`, padding, the
 *   pager's `left`); glass comes and goes by the native `glassEffectStyle`
 *   fade (none ↔ clear), never by opacity.
 *
 * @internal
 */
import { useHeaderHeight } from "@react-navigation/elements";
import { GlassContainer, GlassView } from "expo-glass-effect";
import * as React from "react";
import { Keyboard, Pressable, StyleSheet, TextInput, useColorScheme, useWindowDimensions, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
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
import { AGENT_NAME, useAgentButtonVisible } from "./agentButtonSettings";
import { colors } from "./colors";
import { useKeyboardHeightValue } from "./keyboardHeight";
import { COMPOSER_CHIP_SIZE, COMPOSER_FIELD_PADDING, COMPOSER_PILL_HEIGHT, COMPOSER_SEND_CHIP_SIZE } from "./composerBarSpec";
import { PlusChip, SendChip } from "./composerChips";
import { suggestionsFor, type DubzContext, type DubzSuggestion } from "./dubzSuggestions";
import { getBarPage, getDubzDetent, setBarPage, setDubzDetent, type BarPage } from "./settings";
import { composerRestingBottom, useKeyboardSlide } from "./useKeyboardSlide";

/** The bar's side inset (BottomBar's), and so the window's. */
const MARGIN = 12;
/** The bottom bar's gap under its pill (BottomBar's bottom padding). */
const BAR_GAP = 8;
/** The collapsed height: the bar's pill, and the smallest detent. */
const MIN_HEIGHT = COMPOSER_PILL_HEIGHT;
/** The page's own height: the bar's pill and the gap under it. */
const PAGE_HEIGHT = MIN_HEIGHT + BAR_GAP;
/** Gap between the window's top and the header at full height. */
const TOP_GAP = 8;
/** Corner radius of the window, and of the pill (the bar's). */
const WINDOW_RADIUS = 30;
/** Grow/shrink duration (ms) for opening and collapsing. */
const ANIM_MS = 320;
/** The window's clear glass fades in (none → clear) over the first ~55% of the
 * grow: native glassEffectStyle `animate` (seconds), the only opacity-free way
 * to fade glass. */
const FADE_S = (ANIM_MS * 0.55) / 1000;
/** The pill's inset inside the expanded window; none collapsed. */
const COMPOSER_INSET = 12;
/** Drag distance (px before the smallest detent) over which the pill's inset
 * closes, so it eases into the bar instead of snapping. */
const COMPOSER_INSET_RANGE = 110;
/** The pill's padding: the bar's collapsed; a little tighter expanded (the
 * window's composer). */
const PILL_PAD_V_EXPANDED = 7;
const PILL_PAD_H_EXPANDED = 8;
/** The handle's top inset at larger detents (a line inside the window top). */
const GRABBER_TOP_EXPANDED = 8;
/** The handle lifts to this (above the pill) at the smallest detent, over the
 * glass tab. */
const TAB_TOP = -24;
/** Snap-to-detent duration on drag release. */
const SNAP_MS = 240;
/** Fling-down velocity (px/s) that collapses the window. */
const FLING_VELOCITY = 1400;
/** How far past the last detent you can keep pulling, and the release point
 * past which (last detent + margin) the window collapses instead of snapping
 * back. */
const DISMISS_ZONE = 120;
const DISMISS_MARGIN = 48;
/** The line of text a collapsed pill shows, and a single line's height. */
const LINE_HEIGHT = 21;
const INPUT_MAX_LINES = 8;

/** How long a page slides on after a swipe is let go. */
export const PAGE_MS = 260;
/** How far (a fraction of the screen) a swipe must carry a page to turn it,
 * unless it is flung. */
export const PAGE_TURN = 0.35;
/** Fling speed (px/s) that turns the page however far it went. */
export const PAGE_FLING = 700;
/** How far a finger moves sideways before a swipe starts paging, and up or
 * down before it gives way to the vertical gestures. */
export const PAGE_SLOP_X = 16;
export const PAGE_SLOP_Y = 12;
export const pageEasing = Easing.out(Easing.cubic);

// ── The page the bar opens to ───────────────────────────────────────────────

let lastPage: BarPage = "compose";
const pageListeners = new Set<() => void>();
const subscribePage = (listener: () => void): (() => void) => {
  pageListeners.add(listener);
  return () => pageListeners.delete(listener);
};
const setLastPage = (page: BarPage): void => {
  if (lastPage === page) return;
  lastPage = page;
  pageListeners.forEach((listener) => listener());
};
getBarPage().then(
  (page) => {
    if (page !== undefined) setLastPage(page);
  },
  (error: unknown) => console.error("[dubz] reading the bar's last page failed", error),
);

/** Remember the page opened, so the bar opens to it next time, anywhere. */
export const rememberPage = (page: BarPage): void => {
  setLastPage(page);
  setBarPage(page).catch((error: unknown) => console.error("[dubz] saving the bar's page failed", error));
};

/** The page the bar opens to (and shows collapsed): the one opened last. */
export const useBarPage = (): BarPage => React.useSyncExternalStore(subscribePage, () => lastPage);

// ── What is typed to Dubz, the same on every screen ─────────────────────────

let draft = "";
const draftListeners = new Set<() => void>();
const subscribeDraft = (listener: () => void): (() => void) => {
  draftListeners.add(listener);
  return () => draftListeners.delete(listener);
};
const setDraft = (text: string): void => {
  draft = text;
  draftListeners.forEach((listener) => listener());
};

// ── The detent last left ────────────────────────────────────────────────────

// A fraction of the drag range (0 = full, 0.5 = mid, 1 = the smallest) plus the
// keyboard height then, so an open sizes the detent before the keyboard
// settles. Shared by every screen's page; persisted across launches.
let savedDetentFrac = 0;
let savedKbFull = 0;
getDubzDetent().then(
  (value) => {
    if (value === undefined) return;
    savedDetentFrac = value.frac;
    savedKbFull = value.kbFull;
  },
  (error: unknown) => console.error("[dubz] reading the detent failed", error),
);
const rememberDetent = (frac: number, kb: number): void => {
  savedDetentFrac = frac;
  savedKbFull = kb;
  setDubzDetent({ frac, kbFull: kb }).catch((error: unknown) => console.error("[dubz] saving the detent failed", error));
};
const atPillFrac = (frac: number): boolean => frac >= 0.98;

const noop = (): void => undefined;

/** Sliding back to the composer, where it is beside this page. */
export interface PageBack {
  /** Where the pages stand: 1 this page, 0 the composer. */
  readonly pageX: SharedValue<number>;
  /** A swipe back begins (the composer readies itself, off to the left). */
  readonly begin: () => void;
  /** The swipe turned the page, and the slide has finished. */
  readonly turn: () => void;
  /** The swipe fell back, and the slide has finished. */
  readonly stay: () => void;
}

export interface DubzPageProps {
  readonly open: boolean;
  /** Open or collapse without the grow (a page slid in, or away). */
  readonly instant: boolean;
  /** A tap on the collapsed bar. */
  readonly onOpen: () => void;
  /** Tap outside, a fling down, or the keyboard going down at the smallest
   * detent. */
  readonly onClose: () => void;
  readonly inputRef: React.RefObject<TextInput | null>;
  /** Where it was opened: decides its suggestions (dubzSuggestions.ts). */
  readonly context: DubzContext;
  /** Where the composer is beside it; omitted where Dubz is the only page. */
  readonly pageBack?: PageBack;
}

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

export const DubzPage = (props: DubzPageProps): React.ReactElement => {
  const { open, instant, onOpen, onClose, inputRef, context, pageBack } = props;
  const suggestions = React.useMemo(() => suggestionsFor(context), [context]);
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const scheme = useColorScheme();
  const glassScheme = scheme === "dark" ? "dark" : "light";
  // The app's one keyboard tracker (keyboardHeight.tsx): every screen has a
  // Dubz page, and a tracker each ran them all at once, all the time.
  const kbHeight = useKeyboardHeightValue();
  const { height: screenH, width: screenW } = useWindowDimensions();
  const text = React.useSyncExternalStore(subscribeDraft, () => draft);
  const resting = composerRestingBottom(insets.bottom);
  const windowTop = Math.max(headerHeight, insets.top) + TOP_GAP;

  // `lowered` = below full; the tap-catcher then passes touches through.
  // `pillMode` = settled at the smallest detent (the handle's place follows it,
  // on release). `abovePill` = off the smallest detent right now, live during
  // a drag, so the window's clear glass comes in as it leaves the pill rather
  // than when the drag is let go.
  const [lowered, setLowered] = React.useState(savedDetentFrac > 0.02);
  const [pillMode, setPillMode] = React.useState(atPillFrac(savedDetentFrac));
  const [abovePill, setAbovePill] = React.useState(!atPillFrac(savedDetentFrac));
  const abovePillNow = useSharedValue(!atPillFrac(savedDetentFrac));
  // 0 collapsed → 1 open, by layout (height), never a transform.
  const grow = useSharedValue(0);
  // How far the top is lowered from full height.
  const dragY = useSharedValue(0);
  const dragStart = useSharedValue(0);
  // The full keyboard height, the running max of the live height: the window's
  // height is computed from it, so the detents are the same with the keyboard
  // up or down (the window just rides down with the bar when it goes).
  const kbFull = useSharedValue(savedKbFull);
  // The handle: 0 = a line inside the window top, 1 = lifted over the glass tab.
  const handleT = useSharedValue(atPillFrac(savedDetentFrac) ? 1 : 0);
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

  // The keyboard going down at the smallest detent collapses it: it is the bar
  // with a handle, and without the keyboard just the bar.
  const openNow = React.useRef(open);
  const pillNow = React.useRef(pillMode);
  React.useEffect(() => {
    openNow.current = open;
    pillNow.current = pillMode;
  }, [open, pillMode]);
  const keyboardDown = React.useCallback(() => {
    if (openNow.current && pillNow.current) onClose();
  }, [onClose]);
  useAnimatedReaction(
    () => kbHeight.value,
    (h, previous) => {
      if (h > kbFull.value) kbFull.value = h;
      if (h === 0 && previous !== null && previous > 0) runOnJS(keyboardDown)();
    },
  );

  // Open and collapse, acting only on a change of `open`.
  const wasOpen = React.useRef(open);
  React.useEffect(() => {
    if (wasOpen.current === open) return undefined;
    wasOpen.current = open;
    if (!open) {
      if (inputRef.current?.isFocused() === true) inputRef.current.blur();
      grow.value = instant ? 0 : withTiming(0, { duration: ANIM_MS, easing: Easing.in(Easing.cubic) });
      return undefined;
    }
    // Land at the detent last left, sized from the keyboard height then (the
    // keyboard is not up yet).
    const pill = atPillFrac(savedDetentFrac);
    dragY.value = savedDetentFrac * maxDragFor(savedKbFull);
    kbFull.value = Math.max(kbFull.value, savedKbFull);
    handleT.value = pill ? 1 : 0;
    abovePillNow.value = !pill;
    setLowered(savedDetentFrac > 0.02);
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
  }, [open, instant, inputRef, grow, dragY, kbFull, handleT, abovePillNow, maxDragFor]);

  // Slide the handle to its new spot only after a drag settles.
  React.useEffect(() => {
    handleT.value = withTiming(pillMode ? 1 : 0, { duration: SNAP_MS, easing: Easing.out(Easing.cubic) });
  }, [pillMode, handleT]);

  // Drag the handle to resize, snapping to detents like an iOS sheet, anchored
  // on the bar.
  const drag = React.useMemo(
    () =>
      Gesture.Pan()
        .onBegin(() => {
          resizing.value = true;
          console.log(`[drag-diag] begin dragY=${dragY.value} grow=${grow.value} kbFull=${kbFull.value} maxDrag=${maxDragFor(kbFull.value)}`);
        })
        .onStart(() => {
          dragStart.value = dragY.value;
          console.log(`[drag-diag] start dragY=${dragY.value}`);
        })
        .onUpdate((e) => {
          const maxDrag = maxDragFor(kbFull.value);
          console.log(`[drag-diag] update ty=${e.translationY.toFixed(1)} dragY=${dragY.value.toFixed(1)} maxDrag=${maxDrag.toFixed(1)} kb=${kbHeight.value}`);
          const limit = maxDrag + DISMISS_ZONE;
          const next = dragStart.value + e.translationY;
          dragY.value = next < 0 ? 0 : next > limit ? limit : next;
          const above = dragY.value < maxDrag - 4;
          if (above !== abovePillNow.value) {
            abovePillNow.value = above;
            runOnJS(setAbovePill)(above);
          }
        })
        .onEnd((e) => {
          const maxDrag = maxDragFor(kbFull.value);
          console.log(`[drag-diag] end dragY=${dragY.value.toFixed(1)} vy=${e.velocityY.toFixed(0)}`);
          // Flung down hard, or released past the last detent → collapse.
          if (e.velocityY > FLING_VELOCITY || dragY.value > maxDrag + DISMISS_MARGIN) {
            runOnJS(onClose)();
            return;
          }
          const detents = [0, maxDrag * 0.5, maxDrag];
          const projected = dragY.value + e.velocityY * 0.08;
          let target = 0;
          let best = 1e9;
          for (const detent of detents) {
            const diff = projected - detent;
            const dist = diff < 0 ? -diff : diff;
            if (dist < best) {
              best = dist;
              target = detent;
            }
          }
          dragY.value = withTiming(target, { duration: SNAP_MS, easing: Easing.out(Easing.cubic) });
          const atPill = maxDrag > 0 && target >= maxDrag - 4;
          abovePillNow.value = !atPill;
          runOnJS(setAbovePill)(!atPill);
          runOnJS(setLowered)(target > 4);
          runOnJS(setPillMode)(atPill);
          runOnJS(rememberDetent)(maxDrag > 0 ? target / maxDrag : 0, kbFull.value);
        })
        .onFinalize((_e, success) => {
          resizing.value = false;
          console.log(`[drag-diag] finalize success=${success}`);
        }),
    [dragY, dragStart, resizing, kbFull, kbHeight, grow, abovePillNow, maxDragFor, onClose],
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

  // Swipe right, where the composer is beside it, to slide back to it. Only a
  // clear sideways drag pages. The page's own work (focus, state) waits until
  // the slide has finished, so nothing on the JS side competes with its frames.
  const fallbackPageX = useSharedValue(1);
  const pageX = pageBack?.pageX ?? fallbackPageX;
  const begin = pageBack?.begin ?? noop;
  const turn = pageBack?.turn ?? noop;
  const stay = pageBack?.stay ?? noop;
  const paging = React.useMemo(
    () =>
      Gesture.Pan()
        .enabled(open && pageBack !== undefined)
        .activeOffsetX([-PAGE_SLOP_X, PAGE_SLOP_X])
        .failOffsetY([-PAGE_SLOP_Y, PAGE_SLOP_Y])
        .onStart(() => {
          runOnJS(begin)();
        })
        .onUpdate((e) => {
          pageX.value = 1 - unit(e.translationX / screenW);
        })
        .onEnd((e) => {
          const turned = 1 - pageX.value > PAGE_TURN || e.velocityX > PAGE_FLING;
          pageX.value = withTiming(turned ? 0 : 1, { duration: PAGE_MS, easing: pageEasing }, (finished) => {
            if (finished === true) runOnJS(turned ? turn : stay)();
          });
        }),
    [open, pageBack, pageX, begin, turn, stay, screenW],
  );

  /** The window's height: the bar's collapsed, growing to the detent open. */
  const windowHeight = (): number => {
    "worklet";
    const maxDrag = maxDragFor(kbFull.value);
    const detent = Math.max(maxDrag + MIN_HEIGHT - dragY.value, MIN_HEIGHT);
    return MIN_HEIGHT + (detent - MIN_HEIGHT) * grow.value;
  };
  const windowStyle = useAnimatedStyle(() => ({ height: windowHeight() }));


  // How open the window reads: 0 collapsed or at the smallest detent (the
  // bar), 1 open above the pill's inset range. The pill's inset and padding
  // follow it, so it is the bar at 0 and the window's composer at 1.
  const pillWrapStyle = useAnimatedStyle(() => {
    const openness = grow.value * (1 - pillProgress(dragY.value, maxDragFor(kbFull.value)));
    return {
      paddingHorizontal: COMPOSER_INSET * openness,
      paddingBottom: COMPOSER_INSET * openness,
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

  return (
    <View style={styles.page} pointerEvents="box-none">
      {/* Tap outside to collapse (at full height; lowered, touches pass through
       * to what's behind). Reaches up over the screen from the bar. */}
      {open && !lowered ? (
        <Pressable
          style={[styles.catcher, { height: screenH }]}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={`Close ${AGENT_NAME}`}
        />
      ) : null}

      <GestureDetector gesture={paging}>
        <Reanimated.View style={[styles.window, windowStyle]}>
          <GlassContainer style={styles.fill}>
            <GlassView
              style={styles.glass}
              // Clear while open above the smallest detent; none collapsed and
              // at the pill, where the pill fills it and is the bar. Faded by
              // the native animate, never opacity.
              glassEffectStyle={{ style: open && abovePill ? "clear" : "none", animate: true, animationDuration: FADE_S }}
              // A slight dark tint (tints the glass material, not a solid fill)
              // to give the clear glass some body over bright content.
              tintColor="rgba(0,0,0,0.18)"
              colorScheme={glassScheme}
            >
              {/* What Dubz suggests: the space above the pill, which alone is
               * cropped (no glass in it; nothing above the pill's glass ever
               * clips it). Its contents sit at its bottom, on the pill's top,
               * and never move; the window's top only reveals or hides them. */}
              <View style={styles.suggestionsArea} pointerEvents={open ? "box-none" : "none"}>
                <View style={styles.suggestions}>
                  {suggestions.map((suggestion) => (
                    <Suggestion key={suggestion.kind} suggestion={suggestion} />
                  ))}
                </View>
              </View>
              {/* The pill sits at the window's bottom, a direct child of the
               * window's glass: the bar collapsed, the window's composer open. */}
              <Reanimated.View style={pillWrapStyle}>
                <GestureDetector gesture={dismissKb}>
                  <Reanimated.View style={[styles.pill, pillStyle]}>
                    {/* The bar's regular glass, never faded (opacity on glass
                     * or its parents stops it rendering). */}
                    <View style={StyleSheet.absoluteFill} pointerEvents="none">
                      <GlassView style={styles.pillGlass} glassEffectStyle="regular" colorScheme={glassScheme} />
                    </View>
                    <View style={styles.plusSlot}>
                      <PlusChip onPress={open ? noop : onOpen} />
                    </View>
                    <TextInput
                      ref={inputRef}
                      style={[styles.input, { maxHeight: open ? LINE_HEIGHT * INPUT_MAX_LINES + INPUT_PAD_V : COMPOSER_SEND_CHIP_SIZE }]}
                      value={text}
                      onChangeText={setDraft}
                      placeholder={`Ask ${AGENT_NAME}…`}
                      placeholderTextColor={colors.placeholderText}
                      editable={open}
                      multiline
                    />
                    <SendChip active={text.trim().length > 0} onPress={open ? () => setDraft("") : onOpen} />
                    {/* Collapsed: any tap on the bar opens it. */}
                    {open ? null : (
                      <Pressable style={StyleSheet.absoluteFill} onPress={onOpen} accessibilityRole="button" accessibilityLabel={`Ask ${AGENT_NAME}`} />
                    )}
                  </Reanimated.View>
                </GestureDetector>
              </Reanimated.View>
            </GlassView>
          </GlassContainer>

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
      </GestureDetector>
    </View>
  );
};

/** One suggestion, by its kind. */
const Suggestion = (props: { readonly suggestion: DubzSuggestion }): React.ReactElement | null => {
  switch (props.suggestion.kind) {
    case "tasks":
      // A plain fixed rectangle stands in for the tasks block for now.
      return <View style={styles.placeholder} />;
  }
};

/**
 * The bar where Dubz is the only page (nothing to compose there, as in Files):
 * a Dubz page riding the keyboard where the composer's bar would. Nothing where
 * Dubz is off for the surface.
 */
export const DubzBar = (props: { readonly context: DubzContext }): React.ReactElement | null => {
  const visible = useAgentButtonVisible(props.context.surface);
  const [open, setOpen] = React.useState(false);
  const inputRef = React.useRef<TextInput>(null);
  const insets = useSafeAreaInsets();
  const slide = useKeyboardSlide(composerRestingBottom(insets.bottom));
  const onOpen = React.useCallback(() => {
    rememberPage("dubz");
    setOpen(true);
  }, []);
  const onClose = React.useCallback(() => setOpen(false), []);
  if (!visible) return null;
  return (
    <Reanimated.View style={[styles.standalone, slide]} pointerEvents="box-none">
      <DubzPage open={open} instant={false} onOpen={onOpen} onClose={onClose} inputRef={inputRef} context={props.context} />
    </Reanimated.View>
  );
};

/** The input's vertical padding: a single line is the send button's height,
 * so the collapsed pill is the bar's. */
const INPUT_PAD_TOP = Math.ceil((COMPOSER_SEND_CHIP_SIZE - LINE_HEIGHT) / 2);
const INPUT_PAD_BOTTOM = COMPOSER_SEND_CHIP_SIZE - LINE_HEIGHT - INPUT_PAD_TOP;
const INPUT_PAD_V = INPUT_PAD_TOP + INPUT_PAD_BOTTOM;

const styles = StyleSheet.create({
  // The bar's footprint; the window rises from it, past its top.
  page: {
    height: PAGE_HEIGHT,
  },
  standalone: {
    position: "absolute",
    left: 0,
    right: 0,
  },
  // The window's content, cropped to it; the pill at its bottom.
  // The space above the pill, cropped to the window; its contents at its
  // bottom, on the pill's top. No glass above the pill is ever clipped.
  suggestionsArea: {
    flex: 1,
    overflow: "hidden",
    justifyContent: "flex-end",
  },
  // The suggestions themselves: no padding on the area, so it shrinks to
  // nothing collapsed and leaves the pill exactly the bar.
  suggestions: {
    paddingHorizontal: 16,
    paddingBottom: 16,
    gap: 16,
  },
  placeholder: {
    height: 106,
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  catcher: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
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
  // The bar's pill: +, the text, send, bottom-aligned so they hold their place
  // as the text grows upward. The small drop shadow is the bar's (it does not
  // clip; the glass rounds itself).
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
  // `+` is smaller than send; bottom-aligned, lift it to send's centre.
  plusSlot: {
    marginBottom: (COMPOSER_SEND_CHIP_SIZE - COMPOSER_CHIP_SIZE) / 2,
  },
  input: {
    flex: 1,
    color: colors.label,
    fontSize: 16,
    lineHeight: LINE_HEIGHT,
    paddingTop: INPUT_PAD_TOP,
    paddingBottom: INPUT_PAD_BOTTOM,
    paddingHorizontal: 0,
  },
});
