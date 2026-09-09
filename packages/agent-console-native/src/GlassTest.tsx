/**
 * TEMPORARY on-device test: does the native glass (`GlassView` from
 * expo-glass-effect — the same primitive Home's composer/header use) render on
 * the SPLASH?
 *
 * The splash is the LOADING view: it shows automatically while the app boots and
 * is replaced by Home once loading finishes. So this simulates that — on mount
 * it shows the splash (blue) with the glass for ~4s, then AUTO-transitions to
 * Home (green), exactly like the real launch. No tapping.
 *
 * Glass is translucent, so each box has a bright orange "BEHIND" panel under it:
 *  - GLASS box: working glass shows the orange FROSTED/blurred. Broken glass
 *    shows it SHARP or the box blank.
 *  - PLAIN box: flat translucent white control — always renders.
 *
 * Watch the GLASS box on the blue splash, and whether anything changes at the
 * auto-transition to green Home. "Restart" re-runs it.
 * Delete this file and the `GLASS_TEST` gate in App.tsx once verified.
 */
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { GlassView } from "expo-glass-effect";
import * as React from "react";
import { Button, LayoutAnimation, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors } from "./colors";

/** ms the simulated loading (splash) stays up before Home takes over. */
const LOADING_MS = 4000;

const Stack = createNativeStackNavigator();

/** A bright panel + text that a real glass overlay on top should blur. */
const Behind = (): React.ReactElement => (
  <View style={styles.behind}>
    <Text style={styles.behindText}>BEHIND</Text>
  </View>
);

export const GlassTest = (): React.ReactElement => {
  const insets = useSafeAreaInsets();
  const [phase, setPhase] = React.useState<"loading" | "loaded">("loading");

  // Simulate the app loading: splash (with glass) shows, then auto-finishes.
  React.useEffect(() => {
    if (phase !== "loading") return;
    const timer = setTimeout(() => {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setPhase("loaded");
    }, LOADING_MS);
    return () => clearTimeout(timer);
  }, [phase]);

  const HomePage = React.useCallback(
    (): React.ReactElement => (
      <View style={[styles.page, styles.homeBg, { paddingTop: insets.top + 24 }]}>
        <Text style={styles.heading}>Home — loaded (green)</Text>
        <Text style={styles.sub}>The splash is gone; the app finished loading.</Text>
        <View style={styles.buttonWrap}>
          <Button title="Restart (show splash again)" onPress={() => setPhase("loading")} />
        </View>
      </View>
    ),
    [insets.top],
  );

  // SPLASH: the loading view (blue), auto-shown while "loading". Glass is here.
  if (phase === "loading") {
    return (
      <View style={[styles.page, styles.splashBg, { paddingTop: insets.top + 24 }]}>
        <Text style={styles.heading}>Splash — loading (blue)</Text>
        <Text style={styles.sub}>Shows for {LOADING_MS / 1000}s, then Home takes over automatically.</Text>

        <Text style={styles.label}>GLASS — orange should look FROSTED through it</Text>
        <View style={styles.box}>
          <Behind />
          <GlassView style={styles.overlay}>
            <Text style={styles.tag}>glass</Text>
          </GlassView>
        </View>

        <Text style={styles.label}>PLAIN — control</Text>
        <View style={styles.box}>
          <Behind />
          <View style={[styles.overlay, styles.plainOverlay]}>
            <Text style={styles.tag}>plain</Text>
          </View>
        </View>
      </View>
    );
  }

  // LOADED: the app has finished — mount navigation and show Home.
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
  },
  splashBg: {
    backgroundColor: "#0A2A6B", // blue = splash / loading
  },
  homeBg: {
    backgroundColor: "#0A5C2A", // green = Home / loaded
  },
  heading: {
    color: "#FFFFFF",
    fontSize: 22,
    fontWeight: "700",
  },
  sub: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 14,
    marginBottom: 8,
  },
  label: {
    color: "rgba(255,255,255,0.7)",
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
