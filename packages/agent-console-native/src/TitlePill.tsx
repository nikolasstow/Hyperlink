/**
 * The app's standard header title for a CUSTOM (non-native-nav) header — e.g.
 * the collapsing glass header, and future custom pages. Same design as the
 * native `HeaderTitlePill` (shared tokens in titlePillStyle.ts), built from
 * `expo-glass-effect` so it lives inside a plain RN layout.
 *
 * It hugs its content (a normal RN row), so no width needs computing. `glass`
 * toggles the capsule background — collapsing headers turn it on only once
 * collapsed; the glass is toggled via `glassEffectStyle`, never opacity, since
 * animating a GlassView's opacity stops it rendering glass.
 *
 * @internal
 */
import { GlassView } from "expo-glass-effect";
import * as React from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors } from "./colors";
import { PILL_DOT_GAP, PILL_DOT_SIZE, PILL_FONT_SIZE, PILL_FONT_WEIGHT, PILL_HEIGHT, PILL_PAD_H, PILL_RADIUS } from "./titlePillStyle";

export const TitlePill = (props: {
  readonly title: string;
  /** Show the glass capsule background. Defaults to on; collapsing headers pass
   * `false` while expanded and `true` once collapsed. */
  readonly glass?: boolean;
  /** Trailing status dot: omit for no dot. */
  readonly dot?: "connected" | "disconnected";
}): React.ReactElement => {
  const glass = props.glass ?? true;
  return (
    <View style={styles.wrap}>
      <GlassView
        style={styles.glass}
        glassEffectStyle={{ style: glass ? "regular" : "none", animate: true }}
      />
      <Text
        numberOfLines={1}
        style={styles.text}
      >
        {props.title}
      </Text>
      {props.dot !== undefined ? (
        <View style={[styles.dot, { backgroundColor: props.dot === "connected" ? colors.brand : colors.secondaryLabel }]} />
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: PILL_DOT_GAP,
    height: PILL_HEIGHT,
    paddingHorizontal: PILL_PAD_H,
    borderRadius: PILL_RADIUS,
    borderCurve: "continuous",
    overflow: "hidden",
  },
  glass: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  text: {
    color: colors.label,
    fontSize: PILL_FONT_SIZE,
    fontWeight: PILL_FONT_WEIGHT,
  },
  dot: {
    width: PILL_DOT_SIZE,
    height: PILL_DOT_SIZE,
    borderRadius: PILL_DOT_SIZE / 2,
  },
});
