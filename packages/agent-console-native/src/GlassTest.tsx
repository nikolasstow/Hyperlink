/**
 * TEMPORARY on-device test: does the native glass (`GlassView` from
 * expo-glass-effect — the same primitive Home's composer/header use) render on
 * the SPLASH page?
 *
 * The splash is the first screen and it holds the glass (plus a plain control).
 * A button then navigates to a second page, reproducing splash → Home.
 *
 * What to read on the SPLASH:
 *  - GLASS box blank/invisible, PLAIN box shows → the glass is the culprit.
 *  - Both show → the glass renders fine on the splash; the blank is elsewhere.
 *
 * Delete this file and the `GLASS_TEST` gate in App.tsx once verified.
 */
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { GlassView } from "expo-glass-effect";
import * as React from "react";
import { Button, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors } from "./colors";

const Stack = createNativeStackNavigator();

const SplashPage = ({ navigation }: { navigation: { navigate: (name: string) => void } }): React.ReactElement => {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.page, { paddingTop: insets.top + 24 }]}>
      <Text style={styles.heading}>Splash page</Text>
      <Text style={styles.sub}>This is the splash. If GLASS is blank but PLAIN shows, the glass is the culprit.</Text>

      <Text style={styles.label}>GLASS — should be frosted glass</Text>
      <GlassView style={styles.box}>
        <Text style={styles.boxText}>glass</Text>
      </GlassView>

      <Text style={styles.label}>PLAIN — control</Text>
      <View style={[styles.box, styles.plain]}>
        <Text style={styles.boxText}>plain</Text>
      </View>

      <View style={styles.buttonWrap}>
        <Button title="Go to next page (like Home)" onPress={() => navigation.navigate("Next")} />
      </View>
    </View>
  );
};

const NextPage = ({ navigation }: { navigation: { goBack: () => void } }): React.ReactElement => {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.page, { paddingTop: insets.top + 24 }]}>
      <Text style={styles.heading}>Next page (stands in for Home)</Text>
      <Text style={styles.sub}>Go back to the splash and check the glass again after navigating.</Text>
      <View style={styles.buttonWrap}>
        <Button title="Back to splash" onPress={() => navigation.goBack()} />
      </View>
    </View>
  );
};

export const GlassTest = (): React.ReactElement => (
  <NavigationContainer>
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Splash" component={SplashPage} />
      <Stack.Screen name="Next" component={NextPage} />
    </Stack.Navigator>
  </NavigationContainer>
);

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
