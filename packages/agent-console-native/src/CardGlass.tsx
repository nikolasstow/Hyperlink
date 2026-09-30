/**
 * A card's glass: regular glass behind the card's content, as the repo page's
 * menu is. Put it first inside the card; it fills the card and rounds itself
 * (the card itself carries no fill and clips nothing, since clipping above
 * glass crops it to a flat fallback).
 *
 * @internal
 */
import { GlassView } from "expo-glass-effect";
import * as React from "react";
import { StyleSheet, useColorScheme } from "react-native";

/** The cards' corner radius, the app's standard. */
export const CARD_RADIUS = 14;

export const CardGlass = (props: { readonly radius?: number }): React.ReactElement => {
  const scheme = useColorScheme() === "dark" ? "dark" : "light";
  return (
    <GlassView
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { borderRadius: props.radius ?? CARD_RADIUS }]}
      glassEffectStyle="regular"
      colorScheme={scheme}
    />
  );
};
