/**
 * The app-wide assistant button — "Dubz". A glass circle tinted with the theme
 * SECONDARY accent and a white `sparkles` glyph: the secondary-coloured
 * counterpart to the primary-coloured send button (fill is the accent, glyph is
 * white — the send button's own recipe, so the two read as a pair).
 *
 * A standalone component so every surface that offers the assistant renders the
 * same button (the composer today; repos/sessions/editors as they're wired),
 * and so the future `BottomBar` shell can slot it. The handler is wired later.
 *
 * @internal
 */
import { Button, Host } from "@expo/ui/swift-ui";
import { buttonStyle, foregroundStyle, frame, glassEffect, imageScale, labelStyle } from "@expo/ui/swift-ui/modifiers";
import * as React from "react";
import { StyleSheet, View } from "react-native";
import { useTheme } from "./theme";

/** The assistant's name — used for the button's accessibility label. */
export const AGENT_NAME = "Dubz";
/** Default diameter — sized up toward the glass pill (58) without filling it. */
export const AGENT_BUTTON_SIZE = 46;

export const AgentButton = (props: {
  readonly size?: number;
  readonly onPress?: () => void;
}): React.ReactElement => {
  const { colors } = useTheme();
  const size = props.size ?? AGENT_BUTTON_SIZE;
  return (
    // Small drop shadow on a round wrapper (the button is a circle); the Host
    // itself can't carry it cleanly, and there's no overflow to clip it here.
    <View style={[styles.shadow, { width: size, height: size, borderRadius: size / 2 }]}>
      <Host style={{ width: size, height: size }}>
        <Button
          label={AGENT_NAME}
          systemImage="sparkles"
          onPress={() => props.onPress?.()}
          modifiers={[
            buttonStyle("plain"),
            labelStyle("iconOnly"),
            imageScale("medium"),
            frame({ width: size, height: size }),
            // Fill = secondary accent (translucent so the glass shows), glyph =
            // white. foregroundStyle LAST, after glassEffect — modifier order is
            // significant; before it the glass treatment overrides the glyph
            // colour (same constraint the composer's chips document).
            glassEffect({ glass: { variant: "regular", interactive: true, tint: colors.secondaryFill }, shape: "circle" }),
            foregroundStyle("#FFFFFF"),
          ]}
        />
      </Host>
    </View>
  );
};

const styles = StyleSheet.create({
  shadow: {
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.28,
    shadowRadius: 4,
  },
});
