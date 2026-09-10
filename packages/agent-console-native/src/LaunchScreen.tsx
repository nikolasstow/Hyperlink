/**
 * The body of the launch screen (its header is the shared native nav header —
 * see homeHeader.ts). It pads the skeleton by `useHeaderHeight()`, the exact
 * mechanism HomeScreen uses for its list content, so the cards land where Home's
 * do and nothing shifts when Home takes over. A glass composer bar sits where
 * Home's composer does.
 *
 * No client, no data hooks — just the shared skeleton + chrome — so it can't hit
 * the blank that mounting the full Home early caused.
 *
 * @internal
 */
import { GlassView } from "expo-glass-effect";
import * as React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors } from "./colors";
import { HomeSkeleton } from "./HomeSkeleton";

/** Standard portrait nav-bar content height under the safe-area top. A fixed
 * value on purpose: `useHeaderHeight()` arrives provisional then corrects on the
 * first frames, which made the skeleton jump down-and-up while the (native)
 * header itself stayed put. A constant can't settle, so nothing jitters. */
const NAV_BAR_HEIGHT = 44;

export const LaunchScreen = (): React.ReactElement => {
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.root}>
      <View style={{ paddingTop: insets.top + NAV_BAR_HEIGHT }}>
        <HomeSkeleton />
      </View>
      <GlassView style={[styles.composer, { bottom: insets.bottom + 8 }]}>
        <Text style={styles.composerText}>Plan, ask, build…</Text>
      </GlassView>
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  composer: {
    position: "absolute",
    left: 12,
    right: 12,
    minHeight: 52,
    borderRadius: 26,
    overflow: "hidden",
    justifyContent: "center",
    paddingHorizontal: 18,
  },
  composerText: {
    color: colors.placeholderText,
    fontSize: 17,
  },
});
