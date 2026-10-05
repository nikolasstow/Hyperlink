/**
 * Files' bottom bar, laid out as Safari's compact bar: three glass pieces in a
 * row — back · forward in one capsule, the address pill in the middle, a
 * round button at the end.
 *
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
import { Pressable, StyleSheet, Text, TextInput, useColorScheme, useWindowDimensions, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Reanimated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAgentButtonVisible } from "../agentButtonSettings";
import { FIELD_TINT_DARK, FIELD_TINT_LIGHT } from "../BottomBar";
import { DubzPage, PAGE_MS, pageEasing, type PageBack } from "../Dubz";
import type { DubzContext } from "../dubzSuggestions";
import { SystemIcon } from "../SystemIcon";
import { type TextColors, useTextColors, useThemedStyles } from "../theme";
import { composerRestingBottom, useKeyboardSlide } from "../useKeyboardSlide";

/** The pieces' height (Safari's compact bar), and its buttons' width. */
export const NAV_BAR_HEIGHT = 50;
const BUTTON_WIDTH = 46;
/** How far a finger moves before a swipe on the pill counts, and how far (or
 * how fast) it must go to switch tabs or open the overview. */
const SWIPE_SLOP = 12;
const SWIPE_TURN = 48;
const SWIPE_FLING = 600;

const noop = (): void => undefined;

/** A glass piece of the bar, rounded on itself. */
const Piece = (props: { readonly style: React.ComponentProps<typeof View>["style"]; readonly children: React.ReactNode }): React.ReactElement => {
  const scheme = useColorScheme() === "dark" ? "dark" : "light";
  return (
    <GlassView style={props.style} glassEffectStyle="clear" tintColor={scheme === "dark" ? FIELD_TINT_DARK : FIELD_TINT_LIGHT} colorScheme={scheme}>
      {props.children}
    </GlassView>
  );
};

const NavButton = (props: {
  readonly icon: React.ComponentProps<typeof SystemIcon>["name"];
  readonly label: string;
  readonly enabled: boolean;
  readonly onPress: () => void;
}): React.ReactElement => {
  const styles = useThemedStyles(makeStyles);
  const textColors = useTextColors();
  return (
    <Pressable
      style={styles.button}
      accessibilityRole="button"
      accessibilityLabel={props.label}
      accessibilityState={{ disabled: !props.enabled }}
      disabled={!props.enabled}
      onPress={props.onPress}
    >
      <SystemIcon name={props.icon} size={20} weight="medium" color={props.enabled ? textColors.label : textColors.tertiaryLabel} />
    </Pressable>
  );
};

export const FileNavBar = (props: {
  /** The current tab's name (its file or folder). */
  readonly name: string;
  readonly canGoBack: boolean;
  readonly canGoForward: boolean;
  readonly onBack: () => void;
  readonly onForward: () => void;
  /** The tab overview: a tap on the pill, or a swipe up. */
  readonly onOpenTabs: () => void;
  /** The tab before or after this one: a swipe right or left on the pill. */
  readonly onPreviousTab: () => void;
  readonly onNextTab: () => void;
  /** Where Dubz is: its suggestions. */
  readonly dubzContext: DubzContext;
}): React.ReactElement => {
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const slide = useKeyboardSlide(composerRestingBottom(insets.bottom));
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

  // The pill: a sideways swipe moves between tabs, a swipe up opens the
  // overview, a tap opens it too.
  const { onOpenTabs, onPreviousTab, onNextTab } = props;
  const pillGesture = React.useMemo(() => {
    const swipe = Gesture.Pan()
      .minDistance(SWIPE_SLOP)
      .runOnJS(true)
      .onEnd((e) => {
        const sideways = Math.abs(e.translationX) > Math.abs(e.translationY);
        if (sideways) {
          if (e.translationX < -SWIPE_TURN || e.velocityX < -SWIPE_FLING) onNextTab();
          else if (e.translationX > SWIPE_TURN || e.velocityX > SWIPE_FLING) onPreviousTab();
        } else if (e.translationY < -SWIPE_TURN || e.velocityY < -SWIPE_FLING) {
          onOpenTabs();
        }
      });
    const tap = Gesture.Tap().runOnJS(true).onEnd((_e, success) => {
      if (success) onOpenTabs();
    });
    return Gesture.Exclusive(swipe, tap);
  }, [onOpenTabs, onPreviousTab, onNextTab]);

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
          <Piece style={styles.navPair}>
            <NavButton icon="chevron.backward" label="Back" enabled={props.canGoBack} onPress={props.onBack} />
            <NavButton icon="chevron.forward" label="Forward" enabled={props.canGoForward} onPress={props.onForward} />
          </Piece>
          <GestureDetector gesture={pillGesture}>
            <View style={styles.pillSlot} accessibilityRole="button" accessibilityLabel={`${props.name}, tabs`}>
              <Piece style={styles.pill}>
                <Text style={styles.name} numberOfLines={1}>
                  {props.name}
                </Text>
              </Piece>
            </View>
          </GestureDetector>
          {withDubz ? (
            <Piece style={styles.round}>
              <NavButton icon="bubble.left.and.text.bubble.right" label="Dubz" enabled onPress={toDubz} />
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
    // The composer's margins (BottomBar), so the bars line up.
    bar: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingHorizontal: 12,
      paddingTop: 8,
      paddingBottom: 8,
    },
    navPair: {
      flexDirection: "row",
      height: NAV_BAR_HEIGHT,
      paddingHorizontal: 4,
      borderRadius: NAV_BAR_HEIGHT / 2,
    },
    pillSlot: {
      flex: 1,
    },
    pill: {
      height: NAV_BAR_HEIGHT,
      borderRadius: NAV_BAR_HEIGHT / 2,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 16,
    },
    round: {
      width: NAV_BAR_HEIGHT,
      height: NAV_BAR_HEIGHT,
      borderRadius: NAV_BAR_HEIGHT / 2,
      alignItems: "center",
      justifyContent: "center",
    },
    button: {
      width: BUTTON_WIDTH,
      height: NAV_BAR_HEIGHT,
      alignItems: "center",
      justifyContent: "center",
    },
    name: {
      color: text.label,
      fontSize: 15,
      fontWeight: "600",
    },
  });
