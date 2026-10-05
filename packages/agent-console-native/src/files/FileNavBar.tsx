/**
 * Files' bottom bar, as Safari's: back, forward, the path showing, and tabs,
 * in one glass pill; Dubz is its second page, a swipe away, as beside the
 * composer (Composer.tsx, collapsed: there is nothing to type here, so the
 * pill never expands). It rides the keyboard and follows the bar's glass
 * rules (BottomBar.tsx): the glass rounds itself, nothing clips it, and it
 * moves by layout only.
 *
 * The path is shown only for now (typing one to jump comes later); tabs are a
 * stub. Decisions: docs/handoffs/files-redesign-notes.md.
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
import { FIELD_RADIUS, FIELD_TINT_DARK, FIELD_TINT_LIGHT } from "../BottomBar";
import { colors } from "../colors";
import { COMPOSER_FIELD_PADDING, COMPOSER_SEND_CHIP_SIZE } from "../composerBarSpec";
import { DubzPage, PAGE_FLING, PAGE_MS, PAGE_SLOP_X, PAGE_SLOP_Y, PAGE_TURN, pageEasing, rememberPage, useBarPage, type PageBack } from "../Dubz";
import type { DubzContext } from "../dubzSuggestions";
import { SystemIcon } from "../SystemIcon";
import { type TextColors, useTextColors, useThemedStyles } from "../theme";
import { composerRestingBottom, useKeyboardSlide } from "../useKeyboardSlide";

const noop = (): void => undefined;

/** One of the pill's buttons: an icon, dimmed when it does nothing now. */
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
      hitSlop={6}
    >
      <SystemIcon name={props.icon} size={19} weight="medium" color={props.enabled ? textColors.label : textColors.tertiaryLabel} />
    </Pressable>
  );
};

export const FileNavBar = (props: {
  /** The path showing, as the pill writes it (from the repo's root). */
  readonly path: string;
  readonly canGoBack: boolean;
  readonly canGoForward: boolean;
  readonly onBack: () => void;
  readonly onForward: () => void;
  /** Where Dubz is: its suggestions, and which page the bar opens to. */
  readonly dubzContext: DubzContext;
}): React.ReactElement => {
  const styles = useThemedStyles(makeStyles);
  const scheme = useColorScheme() === "dark" ? "dark" : "light";
  const insets = useSafeAreaInsets();
  const slide = useKeyboardSlide(composerRestingBottom(insets.bottom));
  const { width: screenW } = useWindowDimensions();
  const pageType = props.dubzContext.surface;
  const withDubz = useAgentButtonVisible(pageType);
  const lastPage = useBarPage(pageType);
  const [dubzOpen, setDubzOpen] = React.useState(false);
  const dubzInputRef = React.useRef<TextInput>(null);
  // Where the pages stand: 0 the nav pill, 1 Dubz.
  const pageX = useSharedValue(withDubz && lastPage === "dubz" ? 1 : 0);

  // Closed, the bar shows this page type's page.
  React.useEffect(() => {
    if (dubzOpen) return;
    pageX.value = withDubz && lastPage === "dubz" ? 1 : 0;
  }, [dubzOpen, withDubz, lastPage, pageX]);

  // A swipe left slides Dubz in (its bar; open it with a tap); turned, the
  // page is this page type's from now on.
  const turnToDubz = React.useCallback(() => rememberPage(pageType, "dubz"), [pageType]);
  const toDubz = React.useMemo(
    () =>
      Gesture.Pan()
        .enabled(withDubz)
        .activeOffsetX([-PAGE_SLOP_X, PAGE_SLOP_X])
        .failOffsetY([-PAGE_SLOP_Y, PAGE_SLOP_Y])
        .onUpdate((e) => {
          const moved = -e.translationX / screenW;
          pageX.value = moved < 0 ? 0 : moved > 1 ? 1 : moved;
        })
        .onEnd((e) => {
          const turned = pageX.value > PAGE_TURN || e.velocityX < -PAGE_FLING;
          pageX.value = withTiming(turned ? 1 : 0, { duration: PAGE_MS, easing: pageEasing }, (finished) => {
            if (finished === true && turned) runOnJS(turnToDubz)();
          });
        }),
    [withDubz, pageX, screenW, turnToDubz],
  );
  // Back from Dubz: to this pill (Dubz closes if it was open).
  const pageBack = React.useMemo<PageBack>(
    () => ({
      pageX,
      begin: noop,
      turn: () => {
        rememberPage(pageType, "compose");
        setDubzOpen(false);
      },
      stay: noop,
    }),
    [pageX, pageType],
  );
  const openDubz = React.useCallback(() => {
    rememberPage(pageType, "dubz");
    setDubzOpen(true);
  }, [pageType]);
  const closeDubz = React.useCallback(() => setDubzOpen(false), []);

  const navSlide = useAnimatedStyle(() => ({
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
        <GestureDetector gesture={toDubz}>
          <Reanimated.View style={[styles.bar, navSlide]}>
            <GlassView style={styles.field} glassEffectStyle="clear" tintColor={scheme === "dark" ? FIELD_TINT_DARK : FIELD_TINT_LIGHT} colorScheme={scheme}>
              <View style={styles.row}>
                <NavButton icon="chevron.backward" label="Back" enabled={props.canGoBack} onPress={props.onBack} />
                <NavButton icon="chevron.forward" label="Forward" enabled={props.canGoForward} onPress={props.onForward} />
                <View style={styles.pathPill}>
                  <Text style={styles.path} numberOfLines={1} ellipsizeMode="middle">
                    {props.path}
                  </Text>
                </View>
                {/* Tabs come later. */}
                <NavButton icon="square.on.square" label="Tabs" enabled={false} onPress={noop} />
              </View>
            </GlassView>
          </Reanimated.View>
        </GestureDetector>
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
    // The composer's margins (BottomBar), so the two bars line up.
    bar: {
      paddingHorizontal: 12,
      paddingTop: 8,
      paddingBottom: 8,
    },
    field: {
      padding: COMPOSER_FIELD_PADDING,
      borderRadius: FIELD_RADIUS,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      height: COMPOSER_SEND_CHIP_SIZE,
    },
    button: {
      width: COMPOSER_SEND_CHIP_SIZE,
      height: COMPOSER_SEND_CHIP_SIZE,
      alignItems: "center",
      justifyContent: "center",
    },
    pathPill: {
      flex: 1,
      height: COMPOSER_SEND_CHIP_SIZE,
      justifyContent: "center",
      paddingHorizontal: 12,
      borderRadius: COMPOSER_SEND_CHIP_SIZE / 2,
      backgroundColor: colors.fillBackground,
    },
    path: {
      color: text.label,
      fontFamily: "Menlo",
      fontSize: 13,
    },
  });
