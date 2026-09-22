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
import { AGENT_NAME } from "./agentButtonSettings";
import { COMPOSER_PILL_HEIGHT } from "./composerBarSpec";
import { useDubz } from "./Dubz";
import { useTheme } from "./theme";

/** Default diameter — the glass pill's height, so the circle sits flush with the
 * pill top and bottom rather than floating centred inside it. */
export const AGENT_BUTTON_SIZE = COMPOSER_PILL_HEIGHT;

export const AgentButton = (props: {
  readonly size?: number;
  readonly onPress?: () => void;
}): React.ReactElement => {
  const { colors } = useTheme();
  const scheme = useColorScheme();
  const dubz = useDubz();
  const size = props.size ?? AGENT_BUTTON_SIZE;
  return (
    // Outer wrapper carries the drop shadow — it must NOT clip (no overflow), or
    // it would clip its own shadow.
    <View style={[styles.shadow, { width: size, height: size, borderRadius: size / 2 }]}>
      <Pressable
        onPress={() => {
          // Any per-instance handler runs first, then the app-wide Dubz window opens.
          props.onPress?.();
          dubz.open();
        }}
        accessibilityRole="button"
        accessibilityLabel={AGENT_NAME}
        style={({ pressed }) => [{ opacity: pressed ? 0.85 : 1 }]}
      >
        {/* Round the GLASS itself via `borderRadius` — GlassView maps it to the
         * native UIGlassEffect corner configuration, so the material renders as a
         * true circle. Do NOT wrap it in an `overflow: hidden` clip: that clips the
         * UIVisualEffectView to a hard rectangle and crops the glass edge (the
         * "cropped, not proper glass" look). tintColor + isInteractive tint the
         * material itself, matching the send button's glassEffect. */}
        <GlassView
          style={[styles.glass, { width: size, height: size, borderRadius: size / 2 }]}
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
  glass: {
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
