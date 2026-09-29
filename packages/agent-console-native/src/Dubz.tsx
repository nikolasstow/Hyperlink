/**
 * Dubz — the app-wide assistant surface: a big glass window that animates in
 * and fills most of the screen above the keyboard, with margins all round.
 *
 * It is one of the bottom bar's pages. Where the bar is a composer (Home, a
 * repo, a session), the expanded bar has two pages side by side: the composer,
 * then Dubz; a swipe while expanded slides from one to the other, and either
 * collapses back to the bar. Where there is nothing to compose (Files), Dubz is
 * the bar's only page. The bar opens to the page opened last.
 *
 * It's a single GLOBAL overlay mounted once at the app root (see App.tsx), driven
 * by {@link DubzProvider}'s open/closed state. `useDubz().open()` grows it in
 * from the bar; a swipe from the composer slides it in beside it (`pageX`).
 *
 * For now this is JUST the glass window (keyboard pops up via an autofocused
 * field, but with only placeholder text inside). The actual Dubz agent — chat,
 * content, controls — is a separate later spec that fills this shell in.
 *
 * Glass invariants (learned the hard way — see BottomBar / RepoScreen):
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
import Reanimated, {
  Easing,
  runOnJS,
  useAnimatedKeyboard,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AGENT_NAME } from "./agentButtonSettings";
import { colors } from "./colors";
import { composerRestingBottom } from "./useKeyboardSlide";
import { getBarPage, getDubzDetent, setBarPage, setDubzDetent, type BarPage } from "./settings";
import { useTheme } from "./theme";

/** Gap between the window and the screen edges (left/right) / the keyboard. */
const MARGIN = 12;
/** Gap between the window's top and the safe-area inset at full height. */
const TOP_MARGIN = 0;
/** Corner radius of the glass window. */
const WINDOW_RADIUS = 30;
/** Grow/shrink duration (ms) for the window opening and closing. */
const ANIM_MS = 320;
/** The glass fades in (none → clear) over the first ~55% of the grow — native
 * glassEffectStyle `animate` (seconds), the only opacity-free way to fade glass. */
const FADE_S = (ANIM_MS * 0.55) / 1000;
/** The bottom bar's gap under its pill (BottomBar's bottom padding): at the
 * pill detent the window sits where the bar does. */
const BAR_GAP = 8;
/** Smallest height — the "pill" detent. A full capsule at the window radius; the
 * composer keeps its natural height and is centred within it (pillWrapFill). */
const MIN_HEIGHT = 58;
/** Composer margin inside the window (expanded); collapses to 0 at the pill. */
const COMPOSER_INSET = 12;
/** Drag distance (px before the min detent) over which the composer margins
 * collapse — the composer eases into a full pill instead of snapping. */
const COMPOSER_INSET_RANGE = 110;
/** The single handle's top inset at larger detents (a line inside the window top). */
const GRABBER_TOP_EXPANDED = 8;
/** The handle lifts to this (above the pill) at the min detent, over the glass tab. */
const TAB_TOP = -24;
/** Snap-to-detent duration on drag release. */
const SNAP_MS = 240;
/** Fling-down velocity (px/s) that dismisses the window. */
const FLING_VELOCITY = 1400;
/** How far past the last detent you can keep pulling, and the release point past
 * which (last detent + margin) the window dismisses instead of snapping back. */
const DISMISS_ZONE = 120;
const DISMISS_MARGIN = 48;
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

// The page the bar last opened to, remembered across launches.
let lastPage: BarPage = "compose";
export const rememberPage = (page: BarPage): void => {
  lastPage = page;
  void setBarPage(page);
};
/** The page the bottom bar opens to: the one opened last. */
export const barPage = (): BarPage => lastPage;

// Last detent the window was left at, remembered across close/reopen (session
// lifetime): a fraction of maxDrag (0 = full, 0.5 = mid, 1 = pill) plus the
// keyboard height then, so the reopen can size the detent before the keyboard
// settles. Module-level so it survives the window unmounting on close.
let savedDetentFrac = 0;
let savedKbFull = 0;
const rememberDetent = (frac: number, kb: number): void => {
  savedDetentFrac = frac;
  savedKbFull = kb;
  // Persist so the detent survives an app restart (fire-and-forget).
  void setDubzDetent({ frac, kbFull: kb });
};

/** A screen's composer, the page beside Dubz while that screen shows. */
export interface ComposePage {
  readonly id: number;
  /** Keep the composer expanded (it is sliding in, not yet focused), or stop. */
  readonly hold: (held: boolean) => void;
  readonly focus: () => void;
}

/** How the window arrives: grown out of the bar, or slid in beside the
 * composer by a swipe. */
type Arrival = "grow" | "slide";

interface DubzApi {
  /** Grow the window out of the bar. */
  readonly open: () => void;
  /** Shrink it back into the bar. */
  readonly close: () => void;
  /** Become the bar at once: the window, at the pill detent, already sits
   * where the bar is and looks as it does. */
  readonly closeIntoBar: () => void;
  readonly isOpen: boolean;
  readonly arrival: Arrival;
  /** Whether Dubz is the page showing (the window is mounted beside the
   * composer, off screen, while the composer is). */
  readonly onDubz: boolean;
  /** Where the pages stand: 0 the composer, 1 Dubz, between while sliding.
   * Both follow it by layout (`left`, margins), never a transform. */
  readonly pageX: SharedValue<number>;
  /** The composer that slides with the pages (its `id`), or -1: the rest stay
   * put. */
  readonly slidingCompose: SharedValue<number>;
  /** Whether a composer is beside Dubz (the focused screen has one). */
  readonly hasCompose: boolean;
  /** A screen's composer takes its place beside Dubz; returns its leaving. */
  readonly registerCompose: (page: ComposePage) => () => void;
  /** The composer expanded: the window mounts beside it, off to the right,
   * so a swipe finds it there. */
  readonly prepare: (composeId: number) => void;
  /** That composer collapsed: the window it mounted goes, unless Dubz shows. */
  readonly unprepare: (composeId: number) => void;
  /** A swipe from the composer begins: it holds itself expanded. */
  readonly beginFromCompose: (composeId: number) => void;
  /** The swipe turned the page: Dubz takes the keyboard. */
  readonly settleOnDubz: () => void;
  /** The swipe fell back: the composer stays. */
  readonly stayOnCompose: () => void;
  /** A swipe from Dubz begins: the composer holds itself expanded, off to the
   * left. */
  readonly beginFromDubz: () => void;
  /** That swipe turned the page: the composer takes the keyboard. */
  readonly settleOnCompose: () => void;
  /** The window's input, focused when a swipe lands on Dubz. */
  readonly inputRef: React.RefObject<TextInput | null>;
  /** Set when the window should go at once, without shrinking. */
  readonly instantClose: React.RefObject<boolean>;
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
  const [arrival, setArrival] = React.useState<Arrival>("grow");
  const [onDubz, setOnDubz] = React.useState(false);
  const pageX = useSharedValue(1);
  const slidingCompose = useSharedValue(-1);
  const inputRef = React.useRef<TextInput>(null);
  const instantClose = React.useRef(false);
  const compose = React.useRef<ComposePage | undefined>(undefined);
  const [hasCompose, setHasCompose] = React.useState(false);
  // Read by callbacks without re-creating them: whether the window is open,
  // whether Dubz shows, and which composer mounted it beside itself.
  const openNow = React.useRef(false);
  const onDubzNow = React.useRef(false);
  const preparedBy = React.useRef(-1);
  const show = React.useCallback((open: boolean) => {
    openNow.current = open;
    setIsOpen(open);
  }, []);
  const showDubz = React.useCallback((shown: boolean) => {
    onDubzNow.current = shown;
    setOnDubz(shown);
  }, []);
  // Load the persisted detent and page once, before the user can open the
  // window, so the first open after an app restart lands where it was left.
  React.useEffect(() => {
    void getDubzDetent().then((v) => {
      if (v !== undefined) {
        savedDetentFrac = v.frac;
        savedKbFull = v.kbFull;
      }
    });
    void getBarPage().then((page) => {
      if (page !== undefined) lastPage = page;
    });
  }, []);
  const open = React.useCallback(() => {
    // A drop the window never mounted for must not make this close instant.
    instantClose.current = false;
    preparedBy.current = -1;
    pageX.value = 1;
    slidingCompose.value = -1;
    setArrival("grow");
    showDubz(true);
    show(true);
    rememberPage("dubz");
  }, [pageX, slidingCompose, show, showDubz]);
  const close = React.useCallback(() => {
    // The composer comes back to its place and collapses into the bar as the
    // window shrinks.
    slidingCompose.value = -1;
    preparedBy.current = -1;
    showDubz(false);
    show(false);
    compose.current?.hold(false);
  }, [slidingCompose, show, showDubz]);
  const closeIntoBar = React.useCallback(() => {
    if (!onDubzNow.current) return;
    instantClose.current = true;
    close();
  }, [close]);
  const registerCompose = React.useCallback((page: ComposePage) => {
    compose.current = page;
    setHasCompose(true);
    return () => {
      if (compose.current?.id !== page.id) return;
      compose.current = undefined;
      setHasCompose(false);
    };
  }, []);
  const prepare = React.useCallback(
    (composeId: number) => {
      if (openNow.current) return;
      instantClose.current = false;
      preparedBy.current = composeId;
      pageX.value = 0;
      slidingCompose.value = composeId;
      setArrival("slide");
      showDubz(false);
      show(true);
    },
    [pageX, slidingCompose, show, showDubz],
  );
  const unprepare = React.useCallback(
    (composeId: number) => {
      if (preparedBy.current !== composeId || onDubzNow.current || !openNow.current) return;
      preparedBy.current = -1;
      instantClose.current = true;
      slidingCompose.value = -1;
      show(false);
    },
    [slidingCompose, show],
  );
  const beginFromCompose = React.useCallback(
    (composeId: number) => {
      if (!openNow.current) prepare(composeId);
      slidingCompose.value = composeId;
      // Stays expanded as it slides away, rather than collapsing on the way.
      compose.current?.hold(true);
    },
    [prepare, slidingCompose],
  );
  const settleOnDubz = React.useCallback(() => {
    showDubz(true);
    inputRef.current?.focus();
    rememberPage("dubz");
  }, [showDubz]);
  const stayOnCompose = React.useCallback(() => compose.current?.hold(false), []);
  const beginFromDubz = React.useCallback(() => {
    const page = compose.current;
    if (page === undefined) return;
    slidingCompose.value = page.id;
    preparedBy.current = page.id;
    page.hold(true);
  }, [slidingCompose]);
  const settleOnCompose = React.useCallback(() => {
    showDubz(false);
    compose.current?.focus();
    rememberPage("compose");
  }, [showDubz]);
  const api = React.useMemo<DubzApi>(
    () => ({
      open,
      close,
      closeIntoBar,
      isOpen,
      arrival,
      onDubz,
      pageX,
      slidingCompose,
      hasCompose,
      registerCompose,
      prepare,
      unprepare,
      beginFromCompose,
      settleOnDubz,
      stayOnCompose,
      beginFromDubz,
      settleOnCompose,
      inputRef,
      instantClose,
    }),
    [open, close, closeIntoBar, isOpen, arrival, onDubz, pageX, slidingCompose, hasCompose, registerCompose, prepare, unprepare, beginFromCompose, settleOnDubz, stayOnCompose, beginFromDubz, settleOnCompose],
  );
  return <DubzContext.Provider value={api}>{props.children}</DubzContext.Provider>;
};

/**
 * Mounted once at the root, but the heavy window — its `useAnimatedKeyboard`
 * tracking, gestures and layout animation — is only mounted while Dubz is open,
 * or while a composer beside it is expanded (mounted off screen, so a swipe
 * finds it ready; mounting it mid-swipe hitched the slide). Keeping those hooks
 * alive otherwise ran a global keyboard listener (fighting the composer's) and
 * bogged the whole app down.
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
  const { isOpen, close, closeIntoBar, arrival, onDubz, pageX, hasCompose, beginFromDubz, settleOnCompose, inputRef, instantClose } = useDubz();
  // How this mount came: fixed for its life (a later open is a new mount).
  const [arrivedBy] = React.useState(arrival);
  const insets = useSafeAreaInsets();
  const scheme = useColorScheme();
  const { colors: themeColors } = useTheme();
  // Destructure the height SHARED VALUE — capturing the whole useAnimatedKeyboard
  // object (KeyboardImpl) in a worklet fails to serialize to the UI thread.
  const { height: kbHeight } = useAnimatedKeyboard();
  const { height: screenH, width: screenW } = useWindowDimensions();
  const [text, setText] = React.useState("");

  // `entered` toggles the native glass none↔clear (its own animate fades it, no
  // opacity); `grow` (0→1) scales the window via LAYOUT (never a transform, which
  // would composite and kill the glass); `dragY` is the drag-bar offset.
  const [entered, setEntered] = React.useState(false);
  // `lowered` = dragged below full; the tap-catcher then passes touches through.
  // `pillMode` = at the min detent. Both seed from the remembered detent so the
  // window reopens in the state it was left.
  const [lowered, setLowered] = React.useState(savedDetentFrac > 0.02);
  const [pillMode, setPillMode] = React.useState(savedDetentFrac >= 0.98);
  const grow = useSharedValue(0);
  const dragY = useSharedValue(0); // 0 = full height; positive = top lowered
  const dragStart = useSharedValue(0);
  // The full (resting) keyboard height, tracked as the running max of the live
  // height. The window's HEIGHT is computed from this stable value while its
  // bottom edge rides the LIVE keyboard — so dismissing the keyboard keeps the
  // window's height and just drops it to the bottom of the screen (rather than
  // growing it downward), and the detents are the same with the keyboard present
  // or gone.
  //
  // Seeded with the keyboard height remembered with the detent: the window
  // opens at a position computed from that height, so every size must start
  // from it too. Starting at 0 laid the composer out as if there were no
  // keyboard (margins and frost at the wrong point of their collapse) until
  // the keyboard appeared and put it right: the misalignment that "fixed
  // itself".
  const kbFull = useSharedValue(savedKbFull);
  // Drives the handle's position: 0 = the line inside the window top, 1 = lifted
  // over the glass tab. Animated on RELEASE (when pillMode settles), not during the
  // drag — so the handle holds still while dragging and slides only after you let go.
  const handleT = useSharedValue(savedDetentFrac >= 0.98 ? 1 : 0);
  useAnimatedReaction(
    () => kbHeight.value,
    (h) => {
      if (h > kbFull.value) kbFull.value = h;
    },
  );
  // At the pill detent the window is the bottom bar with a grab handle; when
  // the keyboard goes down there, it is just the bar: Dubz closes into it.
  const pillNow = React.useRef(pillMode);
  React.useEffect(() => {
    pillNow.current = pillMode;
  }, [pillMode]);
  const keyboardDown = React.useCallback(() => {
    if (pillNow.current) closeIntoBar();
  }, [closeIntoBar]);
  useAnimatedReaction(
    () => kbHeight.value,
    (h, previous) => {
      if (h === 0 && previous !== null && previous > 0) runOnJS(keyboardDown)();
    },
  );
  // True from the moment a resize drag touches down until it finalizes — the
  // composer's swipe-down-to-dismiss gesture ignores its end while this is set,
  // so lowering the window can never also dismiss the keyboard.
  const resizing = useSharedValue(false);

  // Grow + fade IN on mount, on the next frame — starting the timing mid-mount /
  // mid-glass-init dropped the first frames (the entrance jitter). Seed dragY to
  // the remembered detent (sized from the saved keyboard height, since the live
  // keyboard hasn't opened yet) so the window grows straight into that detent.
  React.useEffect(() => {
    grow.value = 0;
    const stableBottom = Math.max(savedKbFull, insets.bottom) + MARGIN;
    const maxDrag = Math.max(screenH - (insets.top + TOP_MARGIN) - stableBottom - MIN_HEIGHT, 0);
    dragY.value = savedDetentFrac * maxDrag;
    // Slid in by a swipe: already full size, beside the composer.
    if (arrivedBy === "slide") {
      grow.value = 1;
      setEntered(true);
      return undefined;
    }
    const id = requestAnimationFrame(() => {
      grow.value = withTiming(1, { duration: ANIM_MS, easing: Easing.out(Easing.cubic) });
      setEntered(true);
    });
    return () => cancelAnimationFrame(id);
  }, [grow, dragY, insets.top, insets.bottom, screenH, arrivedBy]);

  // Slide the handle to its new spot only after a drag settles (pillMode changes),
  // never during the drag itself.
  React.useEffect(() => {
    handleT.value = withTiming(pillMode ? 1 : 0, { duration: SNAP_MS, easing: Easing.out(Easing.cubic) });
  }, [pillMode, handleT]);

  // Exit when closed: fade + shrink out, then unmount via onClosed.
  React.useEffect(() => {
    if (isOpen) return undefined;
    // Gone at once (a page turned away, or never arrived): no shrink, and the
    // keyboard stays with the composer.
    if (instantClose.current) {
      instantClose.current = false;
      onClosed();
      return undefined;
    }
    Keyboard.dismiss();
    setEntered(false);
    grow.value = withTiming(0, { duration: ANIM_MS, easing: Easing.in(Easing.cubic) });
    const t = setTimeout(onClosed, ANIM_MS + 40);
    return () => clearTimeout(t);
  }, [isOpen, onClosed, grow, instantClose]);

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
          const fullTop = topInset + TOP_MARGIN;
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
          const fullTop = topInset + TOP_MARGIN;
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
          // Remember this detent so the window reopens where it was left.
          runOnJS(rememberDetent)(maxDrag > 0 ? target / maxDrag : 0, kbFull.value);
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

  // Swipe right, while a composer is beside Dubz, to slide back to it. Only a
  // clear sideways drag pages; up and down stay the resize and keyboard drags.
  const pageBack = React.useMemo(
    () =>
      Gesture.Pan()
        .enabled(hasCompose)
        .activeOffsetX([-PAGE_SLOP_X, PAGE_SLOP_X])
        .failOffsetY([-PAGE_SLOP_Y, PAGE_SLOP_Y])
        .onStart(() => {
          runOnJS(beginFromDubz)();
        })
        .onUpdate((e) => {
          const moved = e.translationX / screenW;
          pageX.value = 1 - (moved < 0 ? 0 : moved > 1 ? 1 : moved);
        })
        .onEnd((e) => {
          // The window stays mounted off to the right while the composer is
          // up, so the next swipe finds it there.
          const turned = 1 - pageX.value > PAGE_TURN || e.velocityX > PAGE_FLING;
          if (turned) runOnJS(settleOnCompose)();
          pageX.value = withTiming(turned ? 0 : 1, { duration: PAGE_MS, easing: pageEasing });
        }),
    [hasCompose, screenW, pageX, beginFromDubz, settleOnCompose],
  );

  // Grows via LAYOUT (animating `top`), never a transform — a transform/opacity
  // would composite the subtree and stop the glass rendering. Full width the whole
  // time (left/right fixed); the bottom is anchored at the keyboard, and the top
  // animates from the bottom edge (0 height) up to the full top — so the window
  // unfolds upward from the bottom.
  // Where the bar rests, worked out here: a plain function cannot run inside
  // the style worklet, so it takes the number.
  const barResting = composerRestingBottom(insets.bottom);
  const windowStyle = useAnimatedStyle(() => {
    const fullTop = insets.top + TOP_MARGIN;
    // Expanded height is derived from the STABLE keyboard height, so it doesn't
    // change as the keyboard opens/closes — only the position (bottomEdge) does.
    const stableBottom = Math.max(kbFull.value, insets.bottom) + MARGIN;
    // How near the pill detent (0 above the composer's collapse range, 1 at
    // it), as pillPadStyle measures it.
    const maxDrag = Math.max(screenH - fullTop - stableBottom - MIN_HEIGHT, 0);
    const start = Math.max(maxDrag - COMPOSER_INSET_RANGE, 0);
    const raw = maxDrag - start <= 0 ? 0 : (dragY.value - start) / (maxDrag - start);
    const p = raw < 0 ? 0 : raw > 1 ? 1 : raw;
    // Bottom edge rides the LIVE keyboard (sits above it, or above the home
    // indicator when the keyboard is gone); toward the pill detent it moves to
    // where the bottom bar's pill sits, so there the window covers the bar.
    const windowGap = Math.max(kbHeight.value, insets.bottom) + MARGIN;
    const barGap = Math.max(kbHeight.value, barResting) + BAR_GAP;
    const bottomEdge = screenH - (windowGap + (barGap - windowGap) * p);
    const fullHeight = screenH - stableBottom - fullTop;
    const height = Math.max(fullHeight * grow.value - dragY.value, 0);
    // Off to the right by how far the pages stand from Dubz.
    const aside = (1 - pageX.value) * screenW;
    return {
      top: bottomEdge - height,
      height,
      left: MARGIN + aside,
      right: MARGIN - aside,
    };
  });

  // The composer's margins collapse CONTINUOUSLY as the window nears the pill
  // (min) detent, tracking the drag, so it grows into a full-width pill smoothly
  // instead of popping edge-to-edge the instant the detent latches. Only the last
  // COMPOSER_INSET_RANGE px of travel animate it; higher detents keep the margins.
  const pillPadStyle = useAnimatedStyle(() => {
    const fullTop = insets.top + TOP_MARGIN;
    const stableBottom = Math.max(kbFull.value, insets.bottom) + MARGIN;
    const maxDrag = Math.max(screenH - fullTop - stableBottom - MIN_HEIGHT, 0);
    const start = Math.max(maxDrag - COMPOSER_INSET_RANGE, 0);
    const denom = maxDrag - start;
    const raw = denom <= 0 ? 0 : (dragY.value - start) / denom;
    const p = raw < 0 ? 0 : raw > 1 ? 1 : raw;
    // Horizontal margin collapses from 12 toward 2 (not 0) at the pill; the bottom
    // (Y) decreases by 4px, so the composer keeps distance from both glass edges.
    return { paddingHorizontal: COMPOSER_INSET - 10 * p, paddingBottom: COMPOSER_INSET - 4 * p };
  });

  // The composer's frosted glass fades out over the SAME travel as the margins,
  // so the frost→clear fade rides the grow/shrink continuously (a discrete
  // glassEffectStyle switch can't be interpolated, so it never reads as a fade).
  // At the pill detent the frost is gone and the clear window shows through — no
  // visible pill-in-pill.
  const frostStyle = useAnimatedStyle(() => {
    const fullTop = insets.top + TOP_MARGIN;
    const stableBottom = Math.max(kbFull.value, insets.bottom) + MARGIN;
    const maxDrag = Math.max(screenH - fullTop - stableBottom - MIN_HEIGHT, 0);
    const start = Math.max(maxDrag - COMPOSER_INSET_RANGE, 0);
    const denom = maxDrag - start;
    const raw = denom <= 0 ? 0 : (dragY.value - start) / denom;
    const p = raw < 0 ? 0 : raw > 1 ? 1 : raw;
    return { opacity: 1 - p };
  });

  // The handle sits inside the window top and lifts over the glass tab — driven by
  // handleT, which animates only after a drag settles (see the effect above).
  const handleStyle = useAnimatedStyle(() => ({
    top: GRABBER_TOP_EXPANDED + (TAB_TOP - GRABBER_TOP_EXPANDED) * handleT.value,
  }));

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {/* Transparent tap-catcher — tap outside to dismiss (at full height). Once
       * lowered, it passes touches through so you can see/scroll what's behind. */}
      <Pressable
        style={StyleSheet.absoluteFill}
        // Beside the composer (not the page showing), it catches nothing.
        pointerEvents={lowered || !onDubz ? "none" : "auto"}
        onPress={close}
        accessibilityRole="button"
        accessibilityLabel="Close Dubz"
      />

      {/* The clear glass window, hosted in a GlassContainer. See-through with
       * refraction (no tint, no scrim); the autofocused input pops the keyboard
       * so the window sits above it. */}
      <GestureDetector gesture={pageBack}>
        <Reanimated.View style={[styles.window, windowStyle]}>
          <GlassContainer style={styles.glassContainer}>
            <GlassView
              style={styles.glass}
              // Fades in via the native animate (none → clear) — no opacity, which
              // would composite and kill the glass. Short duration so it finishes
              // ~30% into the grow.
              // At the pill detent it is the bottom bar, in the bar's regular
              // glass.
              glassEffectStyle={{ style: entered ? (pillMode ? "regular" : "clear") : "none", animate: true, animationDuration: FADE_S }}
              // A slight dark tint (tints the glass material, not a solid fill) to
              // give the clear glass some body over bright content; none as the
              // bar.
              {...(pillMode ? {} : { tintColor: "rgba(0,0,0,0.18)" })}
              colorScheme={scheme === "dark" ? "dark" : "light"}
            >
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
                      ref={inputRef}
                      style={styles.pillInput}
                      value={text}
                      onChangeText={setText}
                      placeholder={`Ask ${AGENT_NAME}…`}
                      placeholderTextColor={colors.placeholderText}
                      // Grown in, it takes the keyboard at once; slid in, when the
                      // page turns (settleOnDubz).
                      autoFocus={arrivedBy === "grow"}
                      multiline
                    />
                    <Pressable
                      style={[styles.sendChip, { backgroundColor: text.trim().length > 0 ? themeColors.sendActiveFill : themeColors.sendMutedFill }]}
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

          {/* Glass tab — a SEPARATE element, fixed just above the pill's top edge. It
           * crossfades in/out via the native glassEffectStyle `animate` (none↔regular),
           * NOT an opacity wrapper: a standalone GlassView under an animated-opacity
           * ancestor stops rendering its glass. */}
          <View style={styles.tabGlassWrap} pointerEvents="none">
            <GlassView
              style={styles.tabGlass}
              glassEffectStyle={{ style: pillMode ? "regular" : "none", animate: true, animationDuration: FADE_S }}
              colorScheme={scheme === "dark" ? "dark" : "light"}
            />
          </View>

          {/* The ONE grabber — a line that just moves up and down (handleStyle): a
           * handle inside the window top at larger detents that floats up over the
           * glass tab at the min detent. The single drag handle at every detent. */}
          <GestureDetector gesture={drag}>
            <Reanimated.View style={[styles.grabHandle, handleStyle]}>
              <View style={styles.grabber} />
            </Reanimated.View>
          </GestureDetector>
        </Reanimated.View>
      </GestureDetector>
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
  // The glass tab — a separate element, fixed just above the pill (bottom lined up
  // with the glass top: top TAB_TOP + height = 0). Rounded top only; fades in via
  // tabGlassStyle at the min detent.
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
    borderCurve: "continuous",
  },
  // The single grabber handle — its `top` is animated (handleStyle) so it moves
  // from inside the window top down to over the glass tab. zIndex above the tab so
  // the line floats over it.
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
  // Pill mode: fill the window (padding comes to 0 via the animated style) and keep
  // the composer at the BOTTOM — filling flips the default to flex-start (top), so
  // pin it back to flex-end to match the expanded layout.
  pillWrapFill: {
    flex: 1,
    justifyContent: "flex-end",
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
