/**
 * Files' bottom bar, laid out as Safari's compact bar: three glass pieces in a
 * row — back · forward in one capsule, the address pill in the middle, a
 * round button at the end.
 *
 * - Back and forward are there only when the tab has somewhere to go: both, a
 *   capsule; one, a circle; neither, the pill takes their room.
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
import { GlassView } from "expo-glass-effect";
import * as React from "react";
import { Pressable, StyleSheet, TextInput, useColorScheme, useWindowDimensions, View, type ViewStyle } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Reanimated, { runOnJS, type SharedValue, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAgentButtonVisible } from "../agentButtonSettings";
import { DubzPage, PAGE_MS, pageEasing, type PageBack } from "../Dubz";
import type { DubzContext } from "../dubzSuggestions";
import { iconForFile } from "../fileIcon";
import { SetiIcon } from "../SetiIcon";
import { setiDefaultGlyph, setiFolderGlyph } from "../setiIcons";
import { SystemIcon } from "../SystemIcon";
import { type TextColors, useTextColors, useThemedStyles } from "../theme";
import { useKeyboardHeightValue } from "../keyboardHeight";
import { CARD_GAP, CARD_SCALE } from "./tabShape";
import { composerRestingBottom } from "../useKeyboardSlide";

/** The pieces' height (Safari's compact bar), and its buttons' width. */
export const NAV_BAR_HEIGHT = 48;
const BUTTON_WIDTH = 44;
/** Back and forward's capsule: both buttons and its padding. */
const NAV_PAIR_PAD = 6;
const NAV_PAIR_WIDTH = BUTTON_WIDTH * 2 + NAV_PAIR_PAD * 2;
/** The bar's margins: at the sides, and under it (above where it rests). */
export const NAV_BAR_SIDE = 28;
const BAR_GAP = 10;
export const NAV_BAR_BOTTOM = 18;
/** The tab's type in the pill: its size, where it sits, and the room between
 * it and the name. */
const PILL_ICON = 20;
const PILL_ICON_LEFT = 14;
const PILL_ICON_GAP = 6;
/** The name's room at its sides: at rest, clear of the icon on both (so a
 * long name stops short of it and a short one stays centred); swiping, its
 * pill's own padding. */
const NAME_ROOM = PILL_ICON_LEFT + PILL_ICON + PILL_ICON_GAP;
const NAME_PAD = 22;
/** How far its card is off the middle (in cards) as a pill's name starts and
 * ends fading. */
const NAME_FADE_START = 0.2;
const NAME_FADE_END = 0.55;
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

interface NavButtonProps {
  readonly icon: React.ComponentProps<typeof SystemIcon>["name"];
  readonly label: string;
  readonly onPress: () => void;
}

const NavButton = (props: NavButtonProps): React.ReactElement => {
  const styles = useThemedStyles(makeStyles);
  const textColors = useTextColors();
  return (
    <Pressable
      style={styles.button}
      accessibilityRole="button"
      accessibilityLabel={props.label}
      onPress={props.onPress}
    >
      <SystemIcon name={props.icon} size={19} weight="medium" color={textColors.label} />
    </Pressable>
  );
};

/** Where a tab's pill can be: the bar between the back button and the round
 * one (`left`, `right`); the cards' size and spacing (FilesScreen). */
interface PillBounds {
  readonly left: number;
  readonly right: number;
  readonly screenWidth: number;
  readonly cardStep: number;
}

/**
 * A tab's pill: its type at its left, its name in the middle. At rest, the
 * current tab's fills the bar between the buttons. Swiping (`paging` to 1),
 * each tab's is its card's: as wide as its name (natural fit: nothing
 * measured), placed toward its card's middle within the part of its card
 * inside `bounds`, and narrowing to that part as the card leaves.
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
}): React.ReactElement => {
  const styles = useThemedStyles(makeStyles);
  const { swipe, paging, offset } = props;
  const { left: boundLeft, right: boundRight, screenWidth, cardStep } = props.bounds;
  // Its card's span on the screen, and the part of it inside the bounds.
  const region = useAnimatedStyle(() => {
    const half = (screenWidth * (1 - (1 - CARD_SCALE) * paging.value)) / 2;
    const middle = screenWidth / 2 + (offset + swipe.value) * cardStep;
    const left = Math.max(middle - half, boundLeft);
    const width = Math.max(0, Math.min(middle + half, boundRight) - left);
    return { left, width };
  });
  // Toward its card's middle: the room before it and after it share the
  // space as the middle sits in the region (all before it past the region's
  // right, all after it past its left).
  const before = useAnimatedStyle(() => {
    const half = (screenWidth * (1 - (1 - CARD_SCALE) * paging.value)) / 2;
    const middle = screenWidth / 2 + (offset + swipe.value) * cardStep;
    const left = Math.max(middle - half, boundLeft);
    const right = Math.min(middle + half, boundRight);
    const at = right > left ? (middle - left) / (right - left) : 0.5;
    return { flexGrow: Math.min(1, Math.max(0, at)) };
  });
  const after = useAnimatedStyle(() => {
    const half = (screenWidth * (1 - (1 - CARD_SCALE) * paging.value)) / 2;
    const middle = screenWidth / 2 + (offset + swipe.value) * cardStep;
    const left = Math.max(middle - half, boundLeft);
    const right = Math.min(middle + half, boundRight);
    const at = right > left ? (middle - left) / (right - left) : 0.5;
    return { flexGrow: 1 - Math.min(1, Math.max(0, at)) };
  });
  // At rest, the whole region; swiping, its name's width.
  const fit = useAnimatedStyle(() => {
    const half = (screenWidth * (1 - (1 - CARD_SCALE) * paging.value)) / 2;
    const middle = screenWidth / 2 + (offset + swipe.value) * cardStep;
    const left = Math.max(middle - half, boundLeft);
    const width = Math.max(0, Math.min(middle + half, boundRight) - left);
    return { minWidth: (1 - paging.value) * width, maxWidth: width };
  });
  // Its name fades as its card moves off the middle; its icon, also as the
  // pages are swiped. The name's room: clear of the icon at rest, its own
  // padding swiping.
  const label = useAnimatedStyle(() => {
    const away = Math.abs(offset + swipe.value);
    return {
      opacity: Math.min(1, Math.max(0, (NAME_FADE_END - away) / (NAME_FADE_END - NAME_FADE_START))),
      marginHorizontal: NAME_ROOM - (NAME_ROOM - NAME_PAD) * paging.value,
    };
  });
  const icon = useAnimatedStyle(() => ({ opacity: 1 - paging.value }));
  const scheme = useColorScheme() === "dark" ? "dark" : "light";
  const { entry } = props;
  return (
    <Reanimated.View style={[styles.pillRegion, region]} pointerEvents="none">
      <Reanimated.View style={before} />
      <Reanimated.View style={[styles.shadow, styles.pillFit, fit]}>
        <GlassView style={styles.pillGlass} glassEffectStyle="regular" colorScheme={scheme}>
          <Reanimated.View style={[styles.pillIcon, icon]}>
            <SetiIcon glyph={entry.kind === "directory" ? setiFolderGlyph ?? setiDefaultGlyph : iconForFile(entry.name).glyph} size={PILL_ICON} />
          </Reanimated.View>
          <Reanimated.Text style={[styles.name, label]} numberOfLines={1}>
            {entry.name}
          </Reanimated.Text>
        </GlassView>
      </Reanimated.View>
      <Reanimated.View style={after} />
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

  // Back and forward, each only when it goes somewhere.
  const back: NavButtonProps = { icon: "chevron.backward", label: "Back", onPress: props.onBack };
  const forward: NavButtonProps = { icon: "chevron.forward", label: "Forward", onPress: props.onForward };
  const navButtons = [...(props.canGoBack ? [back] : []), ...(props.canGoForward ? [forward] : [])];
  // Their piece's width: a capsule for both, a circle for one.
  const navWidth = navButtons.length === 2 ? NAV_PAIR_WIDTH : navButtons.length === 1 ? NAV_BAR_HEIGHT : 0;
  // Where the pills can be (worked out, not measured): from after back and
  // forward to the round button; swiping, a pill reaches a little under it,
  // as Safari's.
  const bounds = React.useMemo(
    (): PillBounds => ({
      left: NAV_BAR_SIDE + (navWidth > 0 ? navWidth + BAR_GAP : 0),
      right: screenW - NAV_BAR_SIDE - (withDubz ? NAV_BAR_HEIGHT + BAR_GAP : 0),
      screenWidth: screenW,
      cardStep: screenW * CARD_SCALE + CARD_GAP,
    }),
    [navWidth, withDubz, screenW],
  );
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
        <Reanimated.View style={[styles.bar, barSlide]}>
          {/* The tabs' pills, under the buttons: the one before, this one,
            * the one after (each only while its card is in the bar). */}
          {props.previous === undefined ? null : <TabPill entry={props.previous} offset={-1} swipe={swipe} paging={paging} bounds={bounds} />}
          <TabPill entry={{ name: props.name, kind: props.kind }} offset={0} swipe={swipe} paging={paging} bounds={bounds} />
          {props.next === undefined ? null : <TabPill entry={props.next} offset={1} swipe={swipe} paging={paging} bounds={bounds} />}
          {navButtons.length === 0 ? null : (
            <Piece style={navButtons.length === 2 ? pieceStyles.navPair : pieceStyles.round}>
              <View style={styles.row}>
                {navButtons.map((button) => (
                  <NavButton key={button.label} icon={button.icon} label={button.label} onPress={button.onPress} />
                ))}
              </View>
            </Piece>
          )}
          {/* Where the pill is at rest: its gestures (the pills are drawn
            * apart, above). */}
          <GestureDetector gesture={props.pillGesture}>
            <View style={styles.pillSlot} accessibilityRole="button" accessibilityLabel={`${props.name}, tabs`} />
          </GestureDetector>
          {withDubz ? (
            <Piece style={pieceStyles.round}>
              <NavButton icon="bubble.left.and.text.bubble.right" label="Dubz" onPress={toDubz} />
            </Piece>
          ) : null}
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
    pillSlot: {
      flex: 1,
      height: NAV_BAR_HEIGHT,
    },
    // A pill's part of the bar (its card's), level with the buttons.
    pillRegion: {
      position: "absolute",
      top: BAR_TOP,
      height: NAV_BAR_HEIGHT,
      flexDirection: "row",
    },
    pillFit: {
      height: NAV_BAR_HEIGHT,
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
    // Its room at its sides (animated: TabPill).
    name: {
      color: text.label,
      fontSize: 15,
      fontWeight: "600",
    },
  });

/** The pieces' shapes (static: Piece reads each one's radius for its shadow). */
const pieceStyles = StyleSheet.create({
  navPair: {
    flexDirection: "row",
    height: NAV_BAR_HEIGHT,
    paddingHorizontal: NAV_PAIR_PAD,
    borderRadius: NAV_BAR_HEIGHT / 2,
  },
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
