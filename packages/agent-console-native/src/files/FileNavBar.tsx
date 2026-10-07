/**
 * Files' bottom bar, laid out as Safari's compact bar: three glass pieces in a
 * row — back · forward in one capsule, the address pill in the middle, a
 * round button at the end.
 *
 * - Back is always there, dimmed when the tab has nowhere back to go; forward
 *   only when it has somewhere, the two then in one capsule (back alone, a
 *   circle).
 * - The address pill shows the current tab's name and is the tab bar: a tap,
 *   or a swipe up, opens the tab overview; a sideways swipe moves between
 *   tabs. Swiping, as Safari's, each tab has its own pill, riding its card:
 *   it shrinks to its name, follows the card's middle, stays between the
 *   back button and the round one (narrowing as its card leaves), and its
 *   name fades as its card moves off the middle. The buttons stay put.
 * - The round button is Dubz: it slides Dubz's bar in (the page beside this
 *   one, as beside the composer) and opens it; closed, Dubz slides away again.
 *
 * It rides the keyboard and follows the bar's glass rules (BottomBar.tsx): each
 * glass rounds itself, nothing clips it, and it moves by layout only.
 * Decisions: docs/handoffs/files-redesign-notes.md §9–§10.
 *
 * @internal
 */
import { GlassContainer, GlassView } from "expo-glass-effect";
import * as React from "react";
import { Pressable, StyleSheet, Text, TextInput, useColorScheme, useWindowDimensions, View, type ViewStyle } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Reanimated, { Easing, runOnJS, type SharedValue, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAgentButtonVisible } from "../agentButtonSettings";
import { DubzPage, PAGE_FLING, PAGE_MS, PAGE_TURN, pageEasing, type PageBack } from "../Dubz";
import type { DubzContext } from "../dubzSuggestions";
import { iconForFile } from "../fileIcon";
import { SetiIcon } from "../SetiIcon";
import { setiDefaultGlyph, setiFolderGlyph } from "../setiIcons";
import { SystemIcon } from "../SystemIcon";
import { type TextColors, useTextColors, useThemedStyles } from "../theme";
import { useKeyboardHeightValue } from "../keyboardHeight";
import { CARD_SCALE, cardStepAt } from "./tabShape";
import { composerRestingBottom } from "../useKeyboardSlide";

/** The pieces' height (Safari's compact bar), and its buttons' width. */
export const NAV_BAR_HEIGHT = 48;
const BUTTON_WIDTH = 44;
/** Back and forward's capsule: both buttons and its padding. */
const NAV_PAIR_WIDTH = BUTTON_WIDTH * 2;
/** The bar's margins: at the sides, and under it (above where it rests). */
export const NAV_BAR_SIDE = 28;
const BAR_GAP = 10;
export const NAV_BAR_BOTTOM = 18;
/** The tab's type in the pill: its size, where it sits, and the room between
 * it and the name. */
const PILL_ICON = 20;
const PILL_ICON_LEFT = 14;
const PILL_ICON_GAP = 6;
/** The name's room at its sides: clear of the icon on both (so a long name
 * stops short of it and a short one stays centred). */
const NAME_ROOM = PILL_ICON_LEFT + PILL_ICON + PILL_ICON_GAP;
/** How far its card is off the middle (in cards) as a pill's name starts and
 * ends fading. */
const NAME_FADE_START = 0.2;
const NAME_FADE_END = 0.55;
/** Swiping, how far a pill reaches past its gap, just under the round button
 * (the glass container blends them where they meet, as Safari's). */
const PILL_REACH = BAR_GAP + 2;
/** The room forward adds to back's circle (the two, one capsule's width), and
 * how it comes and goes. */
const FORWARD_EXTRA = NAV_PAIR_WIDTH - NAV_BAR_HEIGHT;
const FORWARD_MOTION = { duration: 300, easing: Easing.bezier(0.2, 0.8, 0.2, 1) };
/** Room above the pieces. */
const BAR_TOP = 10;

const noop = (): void => undefined;

/** A glass piece of the bar, as Safari's: regular glass, untinted, rounded on
 * itself (nothing around it clips or rounds it, which would flatten it), its
 * small drop shadow on an outer wrapper of the same shape. */
const Piece = (props: { readonly style: ViewStyle; readonly children: React.ReactNode }): React.ReactElement => {
  const styles = useThemedStyles(makeStyles);
  const scheme = useColorScheme() === "dark" ? "dark" : "light";
  return (
    <View style={[styles.shadow, { borderRadius: props.style.borderRadius }]}>
      <GlassView style={props.style} glassEffectStyle="regular" colorScheme={scheme}>
        {props.children}
      </GlassView>
    </View>
  );
};

const NavButton = (props: {
  readonly icon: React.ComponentProps<typeof SystemIcon>["name"];
  readonly label: string;
  /** Dimmed, and does nothing, when false. */
  readonly enabled?: boolean;
  readonly onPress: () => void;
}): React.ReactElement => {
  const enabled = props.enabled ?? true;
  const styles = useThemedStyles(makeStyles);
  const textColors = useTextColors();
  return (
    <Pressable
      style={styles.button}
      accessibilityRole="button"
      accessibilityLabel={props.label}
      accessibilityState={{ disabled: !enabled }}
      disabled={!enabled}
      onPress={props.onPress}
    >
      {/* Dimmed by its own opacity (not its colour: the SwiftUI symbol need
        * not redraw for a new one). */}
      <View style={enabled ? undefined : styles.disabled}>
        <SystemIcon name={props.icon} size={19} weight="medium" color={textColors.label} />
      </View>
    </Pressable>
  );
};

/** Where a tab's pill can be: the bar between the back button and the round
 * one (`left`, `right`); the cards' size and spacing (FilesScreen). */
interface PillBounds {
  readonly left: number;
  readonly right: number;
  readonly screenWidth: number;
}

/**
 * A tab's pill: its type at its left, its name in the middle. At rest, the
 * current tab's fills the bar between the buttons. Swiping (`paging` to 1),
 * each tab's is its card's: it spans its card (less the bar's margins) within
 * `bounds`, narrowing as its card leaves, then, narrower than it is tall, a
 * circle shrinking away.
 *
 * Moved and sized by layout only (it is glass); only its contents fade.
 */
const TabPill = (props: {
  readonly entry: PillEntry;
  /** Its card: -1 the tab before, 0 this one, 1 the one after. */
  readonly offset: number;
  readonly swipe: SharedValue<number>;
  readonly paging: SharedValue<number>;
  readonly bounds: PillBounds;
  /** Forward coming and going (0 to 1): the bounds start after it. */
  readonly forwardShown: SharedValue<number>;
  /** The current tab's pill shows a tabs icon at its right (opens the
   * overview — the pill's own tap, beneath). */
  readonly showTabs?: boolean;
}): React.ReactElement => {
  const styles = useThemedStyles(makeStyles);
  const textColors = useTextColors();
  const { swipe, paging, offset, forwardShown } = props;
  const { left: boundLeft, right: boundRight, screenWidth } = props.bounds;
  const frame = useAnimatedStyle(() => {
    // Its card's span on the screen, less the bar's margins, within the
    // bounds (swiping, reaching just under the round button).
    const half = (screenWidth * (1 - (1 - CARD_SCALE) * paging.value)) / 2;
    const middle = screenWidth / 2 + (offset + swipe.value) * cardStepAt(screenWidth, paging.value);
    const left = Math.max(middle - half + NAV_BAR_SIDE, boundLeft + forwardShown.value * FORWARD_EXTRA);
    const width = Math.max(0, Math.min(middle + half - NAV_BAR_SIDE, boundRight + paging.value * PILL_REACH) - left);
    // Narrower than it is tall: a circle, shrinking.
    const height = Math.min(width, NAV_BAR_HEIGHT);
    return { left, width, height, top: BAR_TOP + (NAV_BAR_HEIGHT - height) / 2 };
  });
  // Its contents fade, whole, as its card moves off the middle; its icon,
  // also as the pages are swiped.
  const fade = useAnimatedStyle(() => {
    const away = Math.abs(offset + swipe.value);
    return { opacity: Math.min(1, Math.max(0, (NAME_FADE_END - away) / (NAME_FADE_END - NAME_FADE_START))) };
  });
  const icon = useAnimatedStyle(() => ({ opacity: 1 - paging.value }));
  // The name as shown: as wide as it is at rest, clipped by the pill as it
  // narrows (never cut down a character at a time).
  const nameWidth = boundRight - boundLeft - NAME_ROOM * 2;
  const scheme = useColorScheme() === "dark" ? "dark" : "light";
  const { entry } = props;
  return (
    <Reanimated.View style={[styles.shadow, styles.pillFrame, frame]} pointerEvents="none">
      <GlassView style={styles.pillGlass} glassEffectStyle="regular" colorScheme={scheme}>
        {/* Clipped inside the glass (never the glass itself). */}
        <Reanimated.View style={[styles.pillClip, fade]}>
          <Reanimated.View style={[styles.pillIcon, icon]}>
            <SetiIcon glyph={entry.kind === "directory" ? setiFolderGlyph ?? setiDefaultGlyph : iconForFile(entry.name).glyph} size={PILL_ICON} />
          </Reanimated.View>
          <View style={[styles.pillName, { width: nameWidth, marginLeft: -nameWidth / 2 }]}>
            <Text style={[styles.name, styles.centred]} numberOfLines={1}>
              {entry.name}
            </Text>
          </View>
          {props.showTabs === true ? (
            <Reanimated.View style={[styles.pillTabs, icon]}>
              <SystemIcon name="square.on.square" size={18} weight="medium" color={textColors.label} />
            </Reanimated.View>
          ) : null}
        </Reanimated.View>
      </GlassView>
    </Reanimated.View>
  );
};

interface PillEntry {
  readonly name: string;
  readonly kind: "directory" | "file";
}

export const FileNavBar = (props: {
  /** The current tab's name (its file or folder), and which it is; the tabs
   * beside it, whose names slide in as the pages are swiped. */
  readonly name: string;
  readonly kind: "directory" | "file";
  readonly previous: PillEntry | undefined;
  readonly next: PillEntry | undefined;
  /** The pill's gestures (the tab bar's: FilesScreen). */
  readonly pillGesture: ReturnType<typeof Gesture.Race>;
  /** The pages' swipe, as a fraction of a page (-1 to the next, 1 to the
   * previous), and how far into paging (0 to 1: the buttons dim). */
  readonly swipe: SharedValue<number>;
  readonly paging: SharedValue<number>;
  readonly canGoBack: boolean;
  readonly canGoForward: boolean;
  readonly onBack: () => void;
  readonly onForward: () => void;
  /** Where Dubz is: its suggestions. */
  readonly dubzContext: DubzContext;
  /** How far it is dropped out of sight as the page scrolls down (0 shown;
   * scrollHide.ts). */
  readonly hidden: SharedValue<number>;
}): React.ReactElement => {
  const styles = useThemedStyles(makeStyles);
  const textColors = useTextColors();
  const insets = useSafeAreaInsets();
  // Rests where the composer rests, rides the keyboard, and drops away as the
  // page scrolls: all one `bottom`, on the UI thread (layout: it is glass).
  const keyboardHeight = useKeyboardHeightValue();
  const restingBottom = composerRestingBottom(insets.bottom);
  const { hidden } = props;
  const slide = useAnimatedStyle(() => ({ bottom: Math.max(keyboardHeight.value, restingBottom) - hidden.value }));
  const { width: screenW } = useWindowDimensions();
  const withDubz = useAgentButtonVisible(props.dubzContext.surface);
  const [dubzOpen, setDubzOpen] = React.useState(false);
  const dubzInputRef = React.useRef<TextInput>(null);
  // Where the pages stand: 0 this bar, 1 Dubz's.
  const pageX = useSharedValue(0);

  // The Dubz button: Dubz's bar slides in, then opens.
  const openDubz = React.useCallback(() => setDubzOpen(true), []);
  const toDubz = React.useCallback(() => {
    pageX.value = withTiming(1, { duration: PAGE_MS, easing: pageEasing }, (finished) => {
      if (finished === true) runOnJS(openDubz)();
    });
  }, [pageX, openDubz]);
  // Closed, it slides away again.
  const closeDubz = React.useCallback(() => {
    setDubzOpen(false);
    pageX.value = withTiming(0, { duration: PAGE_MS, easing: pageEasing });
  }, [pageX]);
  // Swiped back from Dubz's bar: this bar again.
  const pageBack = React.useMemo<PageBack>(() => ({ pageX, begin: noop, turn: () => setDubzOpen(false), stay: noop }), [pageX]);
  // Opening by a swipe that STARTS on the chat button (the pill keeps its own
  // swipe, for tabs): a leftward drag slides Dubz in, finger-tracked; let go
  // past a third (or flung), it settles open, else back. A tap opens it too.
  const openSwipe = React.useMemo(() => {
    const pan = Gesture.Pan()
      .activeOffsetX([-10, 10])
      .failOffsetY([-12, 12])
      .onUpdate((e) => {
        pageX.value = Math.min(1, Math.max(0, -e.translationX / screenW));
      })
      .onEnd((e) => {
        const open = pageX.value > PAGE_TURN || e.velocityX < -PAGE_FLING;
        pageX.value = withTiming(open ? 1 : 0, { duration: PAGE_MS, easing: pageEasing }, (finished) => {
          if (finished === true && open) runOnJS(openDubz)();
        });
      });
    const tap = Gesture.Tap()
      .runOnJS(true)
      .onEnd((_e, success) => {
        if (success) toDubz();
      });
    return Gesture.Race(pan, tap);
  }, [pageX, screenW, openDubz, toDubz]);

  // Where the pills can be (worked out, not measured): from after back and
  // forward to the round button; swiping, a pill reaches a little under it,
  // as Safari's.
  const bounds = React.useMemo(
    (): PillBounds => ({
      left: NAV_BAR_SIDE + NAV_BAR_HEIGHT + BAR_GAP,
      right: screenW - NAV_BAR_SIDE - (withDubz ? NAV_BAR_HEIGHT + BAR_GAP : 0),
      screenWidth: screenW,
    }),
    [withDubz, screenW],
  );
  // Forward comes and goes (0 gone, 1 there): back's circle opens into the
  // capsule (by layout: it is glass), forward fading in at its end.
  const forwardShown = useSharedValue(props.canGoForward ? 1 : 0);
  React.useEffect(() => {
    forwardShown.value = withTiming(props.canGoForward ? 1 : 0, FORWARD_MOTION);
  }, [props.canGoForward, forwardShown]);
  const navWidth = useAnimatedStyle(() => ({ width: NAV_BAR_HEIGHT + forwardShown.value * FORWARD_EXTRA }));
  const scheme = useColorScheme() === "dark" ? "dark" : "light";
  const forwardIcon = useAnimatedStyle(() => ({ opacity: forwardShown.value }));
  const { swipe, paging } = props;

  const barSlide = useAnimatedStyle(() => ({
    marginLeft: -pageX.value * screenW,
    marginRight: pageX.value * screenW,
  }));
  const dubzSlide = useAnimatedStyle(() => ({
    left: (1 - pageX.value) * screenW,
    right: -(1 - pageX.value) * screenW,
  }));

  return (
    <Reanimated.View style={[styles.standalone, slide]} pointerEvents="box-none">
      <View style={styles.pages} pointerEvents="box-none">
        <Reanimated.View style={barSlide}>
          {/* One glass container: pieces that meet blend, as Safari's. */}
          <GlassContainer style={styles.bar}>
          {/* The tabs' pills, under the buttons: the one before, this one,
            * the one after (each only while its card is in the bar). */}
          {props.previous === undefined ? null : <TabPill entry={props.previous} offset={-1} swipe={swipe} paging={paging} bounds={bounds} forwardShown={forwardShown} />}
          <TabPill entry={{ name: props.name, kind: props.kind }} offset={0} swipe={swipe} paging={paging} bounds={bounds} forwardShown={forwardShown} showTabs />
          {props.next === undefined ? null : <TabPill entry={props.next} offset={1} swipe={swipe} paging={paging} bounds={bounds} forwardShown={forwardShown} />}
          {/* Back and forward: one glass, a circle with back alone, opening
            * into a capsule as forward comes. */}
          <Reanimated.View style={[styles.shadow, styles.navFrame, navWidth]}>
            <GlassView style={styles.navGlass} glassEffectStyle="regular" colorScheme={scheme}>
              <View style={styles.backAt}>
                <NavButton icon="chevron.backward" label="Back" enabled={props.canGoBack} onPress={props.onBack} />
              </View>
              <Reanimated.View style={[styles.forwardAt, forwardIcon]} pointerEvents={props.canGoForward ? "auto" : "none"}>
                <NavButton icon="chevron.forward" label="Forward" onPress={props.onForward} />
              </Reanimated.View>
            </GlassView>
          </Reanimated.View>
          {/* Where the pill is at rest: its gestures (the pills are drawn
            * apart, above). */}
          <GestureDetector gesture={props.pillGesture}>
            <View style={styles.pillSlot} accessibilityRole="button" accessibilityLabel={`${props.name}, tabs`} />
          </GestureDetector>
          {withDubz ? (
            <GestureDetector gesture={openSwipe}>
              <Piece style={pieceStyles.round}>
                <View style={styles.buttonHit} accessibilityRole="button" accessibilityLabel="Dubz">
                  <SystemIcon name="bubble.left.and.text.bubble.right" size={19} weight="medium" color={textColors.label} />
                </View>
              </Piece>
            </GestureDetector>
          ) : null}
          </GlassContainer>
        </Reanimated.View>
        {withDubz ? (
          <Reanimated.View style={[styles.dubzPage, dubzSlide]} pointerEvents="box-none">
            <DubzPage open={dubzOpen} instant={false} onOpen={openDubz} onClose={closeDubz} inputRef={dubzInputRef} context={props.dubzContext} pageBack={pageBack} />
          </Reanimated.View>
        ) : null}
      </View>
    </Reanimated.View>
  );
};

const makeStyles = (text: TextColors) =>
  StyleSheet.create({
    // From the screen's top down to the keyboard (or the bar's resting spot),
    // letting touches through where empty, as the composer's container.
    standalone: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
    },
    pages: {
      flex: 1,
      justifyContent: "flex-end",
    },
    dubzPage: {
      position: "absolute",
      top: 0,
      bottom: 0,
    },
    // Safari's margins: room at the sides and between the pieces.
    bar: {
      flexDirection: "row",
      alignItems: "center",
      gap: BAR_GAP,
      paddingHorizontal: NAV_BAR_SIDE,
      paddingTop: BAR_TOP,
      paddingBottom: NAV_BAR_BOTTOM,
    },
    shadow: {
      shadowColor: "#000000",
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.08,
      shadowRadius: 6,
    },
    button: {
      width: BUTTON_WIDTH,
      height: NAV_BAR_HEIGHT,
      alignItems: "center",
      justifyContent: "center",
    },
    row: {
      flexDirection: "row",
    },
    disabled: {
      opacity: 0.3,
    },
    navFrame: {
      height: NAV_BAR_HEIGHT,
      borderRadius: NAV_BAR_HEIGHT / 2,
    },
    navGlass: {
      flex: 1,
      borderRadius: NAV_BAR_HEIGHT / 2,
    },
    // Back at the glass's left, forward at its right, each centred in a
    // circle's width there.
    backAt: {
      position: "absolute",
      left: (NAV_BAR_HEIGHT - BUTTON_WIDTH) / 2,
      top: 0,
    },
    forwardAt: {
      position: "absolute",
      right: (NAV_BAR_HEIGHT - BUTTON_WIDTH) / 2,
      top: 0,
    },
    pillSlot: {
      flex: 1,
      height: NAV_BAR_HEIGHT,
    },
    // Rounded fully at any size (a radius past half its height draws as a
    // capsule, or a circle).
    pillFrame: {
      position: "absolute",
      borderRadius: NAV_BAR_HEIGHT / 2,
    },
    pillGlass: {
      flex: 1,
      borderRadius: NAV_BAR_HEIGHT / 2,
      alignItems: "center",
      justifyContent: "center",
    },
    pillIcon: {
      position: "absolute",
      left: PILL_ICON_LEFT,
      top: 0,
      bottom: 0,
      justifyContent: "center",
    },
    // The tabs icon at the pill's right (a tap on the pill opens the overview).
    pillTabs: {
      position: "absolute",
      right: PILL_ICON_LEFT,
      top: 0,
      bottom: 0,
      justifyContent: "center",
    },
    pillClip: {
      ...StyleSheet.absoluteFill,
      overflow: "hidden",
      borderRadius: NAV_BAR_HEIGHT / 2,
    },
    // The name, centred in the pill at its width at rest.
    pillName: {
      position: "absolute",
      top: 0,
      bottom: 0,
      left: "50%",
      justifyContent: "center",
    },
    centred: {
      textAlign: "center",
    },
    buttonHit: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
    },
    name: {
      color: text.label,
      fontSize: 15,
      fontWeight: "600",
    },
  });

/** The pieces' shapes (static: Piece reads each one's radius for its shadow). */
const pieceStyles = StyleSheet.create({
  pill: {
    height: NAV_BAR_HEIGHT,
    borderRadius: NAV_BAR_HEIGHT / 2,
  },
  round: {
    width: NAV_BAR_HEIGHT,
    height: NAV_BAR_HEIGHT,
    borderRadius: NAV_BAR_HEIGHT / 2,
    alignItems: "center",
    justifyContent: "center",
  },
});
