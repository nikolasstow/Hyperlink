/**
 * TEMPORARY on-device test: reproduce the real launch condition — a non-nav
 * splash that then transitions (LayoutAnimation) into a freshly-mounted
 * NavigationContainer + native-stack screen containing the native glass
 * (`GlassView` from expo-glass-effect, the same primitive Home's composer/header
 * use). That is exactly the path that went blank: bootstrap → mount Home (glass).
 *
 * What to read on the glass page:
 *  - GLASS box blank/invisible, PLAIN box shows → the glass is the culprit
 *    (it renders empty when mounted through this navigation transition).
 *  - Both show → the glass is NOT the cause; look elsewhere.
 *
 * "Restart" re-runs the splash → navigate transition without a full reload.
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

export const GlassTest = (): React.ReactElement => {
  const insets = useSafeAreaInsets();
  const [phase, setPhase] = React.useState<"splash" | "app">("splash");

  const goToApp = React.useCallback((): void => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setPhase("app");
  }, []);

  // Mimic the app auto-proceeding from bootstrap to Home.
  React.useEffect(() => {
    if (phase !== "splash") return;
    const timer = setTimeout(goToApp, 500);
    return () => clearTimeout(timer);
  }, [phase, goToApp]);

  const GlassPage = React.useCallback(
    (): React.ReactElement => (
      <View style={[styles.page, { paddingTop: insets.top + 24 }]}>
        <Text style={styles.heading}>Glass page (stands in for Home)</Text>
        <Text style={styles.sub}>If GLASS is blank but PLAIN shows, the glass broke on this navigation.</Text>

        <Text style={styles.label}>GLASS — should be frosted glass</Text>
        <GlassView style={styles.box}>
          <Text style={styles.boxText}>glass</Text>
        </GlassView>

        <Text style={styles.label}>PLAIN — control</Text>
        <View style={[styles.box, styles.plain]}>
          <Text style={styles.boxText}>plain</Text>
        </View>

        <View style={styles.buttonWrap}>
          <Button title="Restart (splash → navigate again)" onPress={() => setPhase("splash")} />
        </View>
      </View>
    ),
    [insets.top],
  );

  if (phase === "splash") {
    return (
      <View style={[styles.splash, { paddingTop: insets.top + 40 }]}>
        <Text style={styles.heading}>Splash</Text>
        <Text style={styles.sub}>Navigating to the glass page… (like bootstrap → Home)</Text>
        <View style={styles.buttonWrap}>
          <Button title="Go now" onPress={goToApp} />
        </View>
      </View>
    );
  }

  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="GlassPage" component={GlassPage} />
      </Stack.Navigator>
    </NavigationContainer>
  );
};

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    paddingHorizontal: 20,
    gap: 10,
    backgroundColor: colors.background,
  },
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
