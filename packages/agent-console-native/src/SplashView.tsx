/**
 * The JS-side splash, pixel-matched to the native launch screen (the same white
 * sparkles on the same navy). It covers the gap between the native splash being
 * hidden and the first screen being ready — a Metro reload, or the brief
 * bootstrap — so there's never a bare spinner or a flash of empty background.
 *
 * The background is a fixed brand color (not a theme token) on purpose: it has
 * to match the native splash's `backgroundColor`, which is a single value.
 *
 * @internal
 */
import * as React from "react";
import { Image, StyleSheet, View } from "react-native";

/** Matches the `backgroundColor` in the expo-splash-screen plugin config. */
const SPLASH_BACKGROUND = "#1A1B26";

export const SplashView = (): React.ReactElement => (
  <View style={styles.root}>
    <Image source={require("../assets/splash-icon.png")} style={styles.logo} resizeMode="contain" />
  </View>
);

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: SPLASH_BACKGROUND,
  },
  logo: {
    width: 120,
    height: 120,
  },
});
