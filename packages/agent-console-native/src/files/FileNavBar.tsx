/**
 * Files' bottom bar, laid out as Safari's compact bar: three glass pieces in a
 * row — back · forward in one capsule, the address pill in the middle, a
 * round button at the end.
 *
 * - Back and forward are there only when the tab has somewhere to go: both, a
 *   capsule; one, a circle; neither, the pill takes their room.
 * - The address pill shows the current tab's name and is the tab bar: a tap,
 *   or a swipe up, opens the tab overview; a sideways swipe moves between
 *   tabs.
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
import { Pressable, StyleSheet, Text, TextInput, useColorScheme, useWindowDimensions, View, type ViewStyle } from "react-native";
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
/** The pill's padding at its sides. */
const PILL_PAD = 0;
export const NAV_BAR_BOTTOM = 18;
/** The tab's type in the pill: its size, where it sits, and the room between
 * it and the name. */
const PILL_ICON = 20;
const PILL_ICON_LEFT = 14;
const PILL_ICON_GAP = 6;

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

/** A tab's name in the pill: its type at the pill's left, its name in the
 * middle. */
const PillLabel = (props: { readonly entry: PillEntry | undefined; readonly width: number }): React.ReactElement => {
  const styles = useThemedStyles(makeStyles);
  const { entry } = props;
  return (
    <View style={[styles.pillLabel, { width: props.width }]}>
      {entry === undefined ? null : (
        <>
          <View style={styles.pillIcon}>
            <SetiIcon glyph={entry.kind === "directory" ? setiFolderGlyph ?? setiDefaultGlyph : iconForFile(entry.name).glyph} size={PILL_ICON} />
          </View>
          <Text style={styles.name} numberOfLines={1}>
            {entry.name}
          </Text>
        </>
      )}
    </View>
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
  // The pill's width, worked out (the bar's width less the other pieces), so
  // the names slide a whole pill as the pages move a whole page.
  const pillWidth =
    screenW - NAV_BAR_SIDE * 2 - (navWidth > 0 ? navWidth + BAR_GAP : 0) - (withDubz ? NAV_BAR_HEIGHT + BAR_GAP : 0) - PILL_PAD * 2;
  const { swipe, paging } = props;
  const names = useAnimatedStyle(() => ({ transform: [{ translateX: -pillWidth + swipe.value * pillWidth }] }));
  const dim = useAnimatedStyle(() => ({ opacity: 1 - paging.value * 0.6 }));

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
          {navButtons.length === 0 ? null : (
            <Piece style={navButtons.length === 2 ? pieceStyles.navPair : pieceStyles.round}>
              {/* Dimmed while the pages are swiped (the icons, not the glass). */}
              <Reanimated.View style={[styles.row, dim]}>
                {navButtons.map((button) => (
                  <NavButton key={button.label} icon={button.icon} label={button.label} onPress={button.onPress} />
                ))}
              </Reanimated.View>
            </Piece>
          )}
          <GestureDetector gesture={props.pillGesture}>
            <View style={styles.pillSlot} accessibilityRole="button" accessibilityLabel={`${props.name}, tabs`}>
              <Piece style={pieceStyles.pill}>
                {/* The names of the tab before, this one and the one after,
                  * side by side, sliding with the pages; clipped inside the
                  * glass (never the glass itself). */}
                <View style={styles.pillClip} pointerEvents="none">
                  <Reanimated.View style={[styles.names, names]}>
                    <PillLabel entry={props.previous} width={pillWidth} />
                    <PillLabel entry={{ name: props.name, kind: props.kind }} width={pillWidth} />
                    <PillLabel entry={props.next} width={pillWidth} />
                  </Reanimated.View>
                </View>
              </Piece>
            </View>
          </GestureDetector>
          {withDubz ? (
            <Piece style={pieceStyles.round}>
              <Reanimated.View style={dim}>
                <NavButton icon="bubble.left.and.text.bubble.right" label="Dubz" onPress={toDubz} />
              </Reanimated.View>
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
      paddingTop: 10,
      paddingBottom: NAV_BAR_BOTTOM,
    },
    shadow: {
      shadowColor: "#000000",
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.08,
      shadowRadius: 6,
    },
    pillSlot: {
      flex: 1,
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
    pillClip: {
      ...StyleSheet.absoluteFill,
      overflow: "hidden",
      borderRadius: NAV_BAR_HEIGHT / 2,
    },
    names: {
      flexDirection: "row",
      height: NAV_BAR_HEIGHT,
    },
    pillLabel: {
      height: NAV_BAR_HEIGHT,
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
    // Clear of the icon on both sides, so a long name stops short of it and a
    // short one stays centred.
    name: {
      marginHorizontal: PILL_ICON_LEFT + PILL_ICON + PILL_ICON_GAP,
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
