/**
 * The bottom bar's `+` and send buttons, shared by both of its pages (the
 * composer and Dubz) so their bars are the same to the pixel.
 *
 * Each is a real native SwiftUI `Button` (background circle, glass effect and
 * SF Symbol one native element via `@expo/ui`). `glassEffect` is confirmed
 * load-bearing: swapping it for a flat `background()` reintroduced a delayed-
 * alignment bug.
 *
 * @internal
 */
import { Button, Host } from "@expo/ui/swift-ui";
import { buttonStyle, foregroundStyle, frame, glassEffect, imageScale, labelStyle } from "@expo/ui/swift-ui/modifiers";
import * as React from "react";
import { StyleSheet } from "react-native";
import { COMPOSER_CHIP_SIZE, COMPOSER_SEND_CHIP_SIZE } from "./composerBarSpec";
import { useTheme } from "./theme";

type Rgb = readonly [number, number, number];

// Colors mixed toward a neutral (not lowered alpha), staying on the confirmed-
// safe `glassEffect` with a fully opaque tint. `+` is gray mixed toward black.
const mixRgb = (base: Rgb, target: Rgb, factor: number, alpha = 1): string => {
  const [r, g, b] = base.map((channel, i) => Math.round(channel + (target[i] - channel) * factor));
  return alpha === 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${alpha})`;
};
const SYSTEM_GRAY: Rgb = [142, 142, 147];
const WHITE: Rgb = [255, 255, 255];
const BLACK: Rgb = [0, 0, 0];
const GRAY_LIGHTEN_FACTOR = 0.6;
const GRAY_DARKEN_FACTOR = 0.25;
const FILL_ALPHA = 0.85;
const CHIP_FILL = mixRgb(SYSTEM_GRAY, WHITE, GRAY_LIGHTEN_FACTOR, FILL_ALPHA);
const CHIP_ICON = mixRgb(SYSTEM_GRAY, BLACK, GRAY_DARKEN_FACTOR);

// +/send's background, glass effect and icon as one native element.
// `foregroundStyle` LAST, after `glassEffect` — order is significant; before it
// the glass overrode the glyph colour.
const CHIP_BUTTON_MODIFIERS = [
  buttonStyle("plain"),
  labelStyle("iconOnly"),
  imageScale("small"),
  frame({ width: COMPOSER_CHIP_SIZE, height: COMPOSER_CHIP_SIZE }),
  glassEffect({ glass: { variant: "regular", interactive: true, tint: CHIP_FILL }, shape: "circle" }),
  foregroundStyle(CHIP_ICON),
];

// Send has two states: solid green when there's text, muted green when not. The
// glyph stays white in both.
const sendButtonModifiers = (active: boolean, activeFill: string, mutedFill: string) => [
  buttonStyle("plain"),
  labelStyle("iconOnly"),
  imageScale("medium"),
  frame({ width: COMPOSER_SEND_CHIP_SIZE, height: COMPOSER_SEND_CHIP_SIZE }),
  glassEffect({ glass: { variant: "regular", interactive: true, tint: active ? activeFill : mutedFill }, shape: "circle" }),
  foregroundStyle("#FFFFFF"),
];

/** The `+` (attach) button. */
export const PlusChip = (props: { readonly onPress: () => void }): React.ReactElement => (
  <Host style={styles.chipHost}>
    <Button label="Attach" systemImage="plus" onPress={props.onPress} modifiers={CHIP_BUTTON_MODIFIERS} />
  </Host>
);

/** The send button: solid while there is something to send, muted when not.
 * In the theme's primary (the composer's) or secondary (Dubz's), so the two
 * bars tell apart even collapsed. */
export const SendChip = (props: {
  readonly active: boolean;
  readonly onPress: () => void;
  readonly accent?: "primary" | "secondary";
}): React.ReactElement => {
  const { colors: themeColors } = useTheme();
  const secondary = props.accent === "secondary";
  return (
    <Host style={styles.sendChipHost}>
      <Button
        label="Send"
        systemImage="arrow.up"
        onPress={props.onPress}
        modifiers={sendButtonModifiers(
          props.active,
          secondary ? themeColors.secondaryFill : themeColors.sendActiveFill,
          secondary ? themeColors.secondaryMutedFill : themeColors.sendMutedFill,
        )}
      />
    </Host>
  );
};

const styles = StyleSheet.create({
  chipHost: {
    width: COMPOSER_CHIP_SIZE,
    height: COMPOSER_CHIP_SIZE,
  },
  sendChipHost: {
    width: COMPOSER_SEND_CHIP_SIZE,
    height: COMPOSER_SEND_CHIP_SIZE,
  },
});
