/**
 * The tab view's top-right glass: search and history, side by side. Its own
 * glass (the repo filter is in the middle). A fixed width (two circles'
 * targets and its padding), so the top bar places the other pieces without
 * measuring.
 *
 * @internal
 */
import { GlassView } from "expo-glass-effect";
import * as React from "react";
import { Pressable, StyleSheet, useColorScheme, View } from "react-native";
import { SystemIcon } from "../SystemIcon";
import { useTextColors } from "../theme";
import { PILL_HEIGHT } from "../titlePillStyle";

/** Each icon's tap target, and the glass's padding at its ends. */
const ICON_TARGET = 44;
const PAD = 4;
/** Its width (worked out: both targets and the padding). */
export const TAB_TOP_ACTIONS_WIDTH = ICON_TARGET * 2 + PAD * 2;

export const TabTopActions = (props: { readonly onSearch: () => void; readonly onHistory: () => void }): React.ReactElement => {
  const textColors = useTextColors();
  const scheme = useColorScheme() === "dark" ? "dark" : "light";
  return (
    <View style={styles.shadow}>
      <View style={styles.glass}>
        <GlassView style={StyleSheet.absoluteFill} glassEffectStyle="regular" colorScheme={scheme} />
        <Pressable style={styles.icon} accessibilityRole="button" accessibilityLabel="Search" onPress={props.onSearch}>
          <SystemIcon name="magnifyingglass" size={17} weight="medium" color={textColors.label} />
        </Pressable>
        <Pressable style={styles.icon} accessibilityRole="button" accessibilityLabel="History" onPress={props.onHistory}>
          <SystemIcon name="clock" size={17} weight="medium" color={textColors.label} />
        </Pressable>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  shadow: {
    borderRadius: PILL_HEIGHT / 2,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
  },
  glass: {
    width: TAB_TOP_ACTIONS_WIDTH,
    height: PILL_HEIGHT,
    borderRadius: PILL_HEIGHT / 2,
    overflow: "hidden",
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: PAD,
  },
  icon: {
    width: ICON_TARGET,
    height: PILL_HEIGHT,
    alignItems: "center",
    justifyContent: "center",
  },
});
