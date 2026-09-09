/**
 * TEMPORARY on-device test: does the native glass (`GlassView` from
 * expo-glass-effect — the same primitive Home's composer/header use) render on
 * the SPLASH?
 *
 * The splash here is exactly what it is in the real app: a plain launch view,
 * NOT a navigation screen — shown before any NavigationContainer mounts. The
 * glass lives on it. A button then mounts the navigation and goes to a Home-like
 * page, reproducing splash → Home.
 *
 * What to read on the SPLASH (the first thing you see):
 *  - GLASS box blank/invisible, PLAIN box shows → the glass is the culprit.
 *  - Both show → the glass renders fine on the splash; the blank is elsewhere.
 *
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

  // The SPLASH: a plain launch view, NOT inside a navigator — the real launch
  // context. The glass is here; this is what we're testing.
  if (phase === "splash") {
    return (
      <View style={[styles.page, { paddingTop: insets.top + 24 }]}>
        <Text style={styles.heading}>Splash</Text>
        <Text style={styles.sub}>
          The launch view (no navigation yet). If GLASS is blank but PLAIN shows, the glass is the culprit.
        </Text>

        <Text style={styles.label}>GLASS — should be frosted glass</Text>
        <GlassView style={styles.box}>
          <Text style={styles.boxText}>glass</Text>
        </GlassView>

        <Text style={styles.label}>PLAIN — control</Text>
        <View style={[styles.box, styles.plain]}>
          <Text style={styles.boxText}>plain</Text>
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

  // After the splash: mount the NavigationContainer + a Home-like page.
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
    width: 160,
    height: 96,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  plain: {
    backgroundColor: colors.fillBackground,
  },
  boxText: {
    color: colors.label,
    fontSize: 15,
    fontWeight: "600",
  },
  buttonWrap: {
    marginTop: 14,
  },
});
