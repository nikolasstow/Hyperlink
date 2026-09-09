/**
 * TEMPORARY on-device test: does the native glass (`GlassView` from
 * expo-glass-effect — the same primitive Home's composer/header use) survive on
 * the SPLASH (the loading view that renders while the app boots)?
 *
 * Faithful, minimal reproduction — nothing artificial:
 *  - On mount the SPLASH (blue) paints, with the glass on it.
 *  - Immediately (no delay), the same LayoutAnimation the real app uses mounts
 *    Home (green). No hold, no buttons, no restart.
 *
 * Read the result:
 *  - Ends on a BLANK screen (not green Home) → the glass on the splash broke it.
 *  - Blue flash → green Home → glass on the splash is fine; the blank is elsewhere.
 *
 * Glass is translucent, so the glass box has a bright orange "BEHIND" panel under
 * it; working glass frosts it. Reload to re-run. Delete this file and the
 * `GLASS_TEST` gate in App.tsx once verified.
 */
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { GlassView } from "expo-glass-effect";
import * as React from "react";
import { LayoutAnimation, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const Stack = createNativeStackNavigator();

const HomePage = (): React.ReactElement => {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.page, styles.homeBg, { paddingTop: insets.top + 24 }]}>
      <Text style={styles.heading}>Home — loaded (green)</Text>
      <Text style={styles.sub}>The app finished loading. If you got here, the splash glass didn't break it.</Text>
    </View>
  );
};

export const GlassTest = (): React.ReactElement => {
  const insets = useSafeAreaInsets();
  const [phase, setPhase] = React.useState<"loading" | "loaded">("loading");

  // Natural transition on mount — no timer. The splash paints once, then Home
  // mounts through the same LayoutAnimation the real app uses.
  React.useEffect(() => {
    if (phase !== "loading") return;
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setPhase("loaded");
  }, [phase]);

  if (phase === "loading") {
    return (
      <View style={[styles.page, styles.splashBg, { paddingTop: insets.top + 24 }]}>
        <Text style={styles.heading}>Splash — loading (blue)</Text>
        <GlassView style={styles.box}>
          <Text style={styles.tag}>glass</Text>
        </GlassView>
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
  box: {
    width: 220,
    height: 110,
    borderRadius: 22,
    overflow: "hidden",
    marginTop: 12,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.5)",
  },
  tag: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "700",
  },
});
