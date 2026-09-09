/**
 * TEMPORARY on-device test: does the native glass (`GlassView` from
 * expo-glass-effect — the same primitive Home's composer/header use) render on
 * the SPLASH (the plain launch view, before any NavigationContainer mounts)?
 *
 * Glass is TRANSLUCENT — it blurs whatever is behind it — so each test box has a
 * bright orange panel with text BEHIND it, and the overlay on top:
 *  - GLASS box: working glass shows the orange + text FROSTED/blurred. Broken
 *    glass shows the orange + text SHARP (no glass) or the box blank.
 *  - PLAIN box (control): a flat translucent white overlay — always renders.
 *
 * A button then mounts navigation and goes to a Home page (splash → Home).
 * Delete this file and the `GLASS_TEST` gate in App.tsx once verified.
 */
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { GlassView } from "expo-glass-effect";
import * as React from "react";
import { Button, LayoutAnimation, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors } from "./colors";

const Stack = createNativeStackNavigator();

/** A bright panel + text that the overlay on top should blur (if it's glass). */
const Behind = (): React.ReactElement => (
  <View style={styles.behind}>
    <Text style={styles.behindText}>BEHIND</Text>
  </View>
);

const HomePage = (): React.ReactElement => {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.page, { paddingTop: insets.top + 24 }]}>
      <Text style={styles.heading}>Home (navigation mounted)</Text>
      <Text style={styles.sub}>You navigated off the splash. This is the second page.</Text>
    </View>
  );
};

export const GlassTest = (): React.ReactElement => {
  const insets = useSafeAreaInsets();
  const [phase, setPhase] = React.useState<"splash" | "app">("splash");

  if (phase === "splash") {
    return (
      <View style={[styles.page, { paddingTop: insets.top + 24 }]}>
        <Text style={styles.heading}>Splash</Text>
        <Text style={styles.sub}>
          The launch view (no navigation yet). Each box has a bright orange “BEHIND” panel under it.
        </Text>

        <Text style={styles.label}>GLASS — orange should look FROSTED/blurred through it</Text>
        <View style={styles.box}>
          <Behind />
          <GlassView style={styles.overlay}>
            <Text style={styles.tag}>glass</Text>
          </GlassView>
        </View>

        <Text style={styles.label}>PLAIN — control (flat translucent white)</Text>
        <View style={styles.box}>
          <Behind />
          <View style={[styles.overlay, styles.plainOverlay]}>
            <Text style={styles.tag}>plain</Text>
          </View>
        </View>

        <View style={styles.buttonWrap}>
          <Button title="Go to Home (mount navigation)" onPress={() => {
            LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
            setPhase("app");
          }} />
        </View>
      </View>
    );
  }

  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Home" component={HomePage} />
      </Stack.Navigator>
    </NavigationContainer>
  );
};

const styles = StyleSheet.create({
  page: {
    flex: 1,
    paddingHorizontal: 20,
    gap: 8,
    backgroundColor: colors.background,
  },
  heading: {
    color: colors.label,
    fontSize: 22,
    fontWeight: "700",
  },
  sub: {
    color: colors.secondaryLabel,
    fontSize: 14,
    marginBottom: 8,
  },
  label: {
    color: colors.secondaryLabel,
    fontSize: 13,
    marginTop: 10,
  },
  box: {
    width: 220,
    height: 110,
    borderRadius: 22,
    overflow: "hidden",
  },
  behind: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "#FF9F0A",
    alignItems: "center",
    justifyContent: "center",
  },
  behindText: {
    color: "#1A1B26",
    fontSize: 34,
    fontWeight: "800",
    letterSpacing: 2,
  },
  overlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  plainOverlay: {
    backgroundColor: "rgba(255,255,255,0.35)",
  },
  tag: {
    color: "#1A1B26",
    fontSize: 15,
    fontWeight: "700",
  },
  buttonWrap: {
    marginTop: 16,
  },
});
