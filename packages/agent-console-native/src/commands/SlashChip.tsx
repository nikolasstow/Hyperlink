/**
 * An accepted `/name` as a glass capsule: at the start of the composer's
 * input, and at the start of the sent message. Its glass is tinted with the
 * code theme's `chat.slashCommandBackground`, its text the theme's
 * `chat.slashCommandForeground` (slashColors.ts).
 *
 * Sized by its text (a set height, its natural width). Glass rules
 * (BarWindow.tsx): rounded on the GlassView itself, never clipped by a parent,
 * never under an animated opacity or transform.
 *
 * @internal
 */
import { GlassView } from "expo-glass-effect";
import * as React from "react";
import { StyleSheet, Text, useColorScheme, View } from "react-native";
import { useSlashColors } from "./slashColors";

export const SLASH_CHIP_HEIGHT = 24;

export const SlashChip = (props: { readonly name: string }): React.ReactElement => {
  const slashColors = useSlashColors();
  const scheme = useColorScheme() === "dark" ? "dark" : "light";
  return (
    <View style={styles.chip}>
      <GlassView style={[StyleSheet.absoluteFill, styles.glass]} glassEffectStyle="regular" tintColor={slashColors.background} colorScheme={scheme} />
      <Text style={[styles.label, { color: slashColors.foreground }]} numberOfLines={1}>{`/${props.name}`}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  chip: {
    height: SLASH_CHIP_HEIGHT,
    paddingHorizontal: 10,
    justifyContent: "center",
    alignSelf: "flex-start",
  },
  glass: {
    borderRadius: SLASH_CHIP_HEIGHT / 2,
  },
  label: {
    fontSize: 15,
    fontWeight: "600",
  },
});
