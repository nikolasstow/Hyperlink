/**
 * TEMPORARY on-device test to confirm whether the native glass (`GlassView`
 * from expo-glass-effect — the same primitive Home's composer/header use)
 * renders blank when it mounts during a LayoutAnimation, which is the launch
 * condition that turned the screen blank.
 *
 * Read the three boxes:
 *  - "Static glass": mounts on first render. If this is blank, glass is broken
 *    outright.
 *  - "Plain (control)": always renders — proves the screen itself is fine.
 *  - "Animated-mount glass": appears after the button, which fires a
 *    LayoutAnimation then mounts a GlassView. If THIS one is blank while the
 *    static one shows, the glass breaks specifically when mounted mid-animation.
 *
 * Delete this file and the `GLASS_TEST` gate in App.tsx once verified.
 */
import { GlassView } from "expo-glass-effect";
import * as React from "react";
import { Button, LayoutAnimation, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors } from "./colors";

export const GlassTest = (): React.ReactElement => {
  const insets = useSafeAreaInsets();
  const [animatedMounted, setAnimatedMounted] = React.useState(false);

  return (
    <View style={[styles.root, { paddingTop: insets.top + 32 }]}>
      <Text style={styles.heading}>Glass test</Text>
      <Text style={styles.sub}>
        If a GLASS box is blank/invisible but PLAIN shows, the glass is the culprit. The button mounts a glass box during
        a layout animation — the launch condition.
      </Text>

      <Text style={styles.label}>1 · Static glass (mounts on first render)</Text>
      <GlassView style={styles.box}>
        <Text style={styles.boxText}>glass</Text>
      </GlassView>

      <Text style={styles.label}>2 · Plain look-alike (control)</Text>
      <View style={[styles.box, styles.plain]}>
        <Text style={styles.boxText}>plain</Text>
      </View>

      <View style={styles.buttonWrap}>
        <Button title="Mount glass during a layout animation" onPress={() => {
          LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
          setAnimatedMounted(true);
        }} />
      </View>
      {animatedMounted ? (
        <>
          <Text style={styles.label}>3 · Animated-mount glass</Text>
          <GlassView style={styles.box}>
            <Text style={styles.boxText}>glass (animated)</Text>
          </GlassView>
        </>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
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
    width: 140,
    height: 90,
    borderRadius: 20,
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
    marginTop: 12,
  },
});
