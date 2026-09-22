/**
 * The app-wide assistant button — "Dubz". A glass circle tinted with the theme
 * SECONDARY accent and a white `sparkles` glyph: the secondary-coloured
 * counterpart to the primary-coloured send button.
 *
 * Built from `expo-glass-effect`'s `GlassView` (a plain RN view) rather than an
 * `@expo/ui` glass `Button` (a native `Host`). The Host renders its glyph high
 * within its frame, so at this size the button sat visibly above the pill it
 * pairs with — the +/send chips hide the same bias only because they're tiny. A
 * `GlassView` clipped to a circle centres by ordinary RN layout, exactly like
 * the search pill's glass, so it lines up with the pill's height precisely.
 *
 * The circle clip lives on the plain wrapping `Pressable`, never on `GlassView`
 * itself — setting `borderCurve`/clip on the glass breaks the effect (the same
 * invariant the search pill and composer document).
 *
 * @internal
 */
import { Ionicons } from "@expo/vector-icons";
import { GlassView } from "expo-glass-effect";
import * as React from "react";
import { Pressable, StyleSheet, useColorScheme, View } from "react-native";
import { COMPOSER_PILL_HEIGHT } from "./composerBarSpec";
import { useTheme } from "./theme";

/** The assistant's name — used for the button's accessibility label. */
export const AGENT_NAME = "Dubz";
/** Default diameter — the glass pill's height, so the circle sits flush with the
 * pill top and bottom rather than floating centred inside it. */
export const AGENT_BUTTON_SIZE = COMPOSER_PILL_HEIGHT;

export const AgentButton = (props: {
  readonly size?: number;
  readonly onPress?: () => void;
}): React.ReactElement => {
  const { colors } = useTheme();
  const scheme = useColorScheme();
  const size = props.size ?? AGENT_BUTTON_SIZE;
  return (
    // Outer wrapper carries the drop shadow — it must NOT clip (no overflow), or
    // it would clip its own shadow. The circle clip lives on the inner Pressable.
    // (Safe to wrap now: the earlier vertical offset was the @expo/ui Host, not a
    // wrapper — this button is GlassView-based and aligns.)
    <View style={[styles.shadow, { width: size, height: size, borderRadius: size / 2 }]}>
      <Pressable
        onPress={() => props.onPress?.()}
        accessibilityRole="button"
        accessibilityLabel={AGENT_NAME}
        style={({ pressed }) => [
          { width: size, height: size, borderRadius: size / 2, overflow: "hidden", opacity: pressed ? 0.85 : 1 },
        ]}
      >
        {/* Tint the GLASS MATERIAL itself (tintColor + isInteractive), not a
         * colour View washed over it — the wash read as a flat disc, this reads as
         * real Liquid Glass, matching the send button's tinted glassEffect. */}
        <GlassView
          style={styles.fill}
          glassEffectStyle="regular"
          tintColor={colors.secondaryFill}
          isInteractive
          colorScheme={scheme === "dark" ? "dark" : "light"}
        >
          <Ionicons name="sparkles" size={Math.round(size * 0.46)} color="#FFFFFF" />
        </GlassView>
      </Pressable>
    </View>
  );
};

const styles = StyleSheet.create({
  fill: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  shadow: {
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.28,
    shadowRadius: 4,
  },
});
