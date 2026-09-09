/**
 * The Home screen's loading state: placeholder cards that mirror the real
 * session/repo card layout (title, badges, meta), pulsing softly, rather than a
 * bare "Loading…" line. It reads as "content is coming" instead of "nothing is
 * here", so the launch feels immediate.
 *
 * Fills use `tertiarySystemFill` (via `colors.fillBackground`), so it's
 * theme-aware for free. `useNativeDriver` keeps the pulse off the JS thread.
 *
 * @internal
 */
import * as React from "react";
import { Animated, StyleSheet, View } from "react-native";
import type { DimensionValue } from "react-native";
import { colors } from "./colors";

/** A single placeholder card matching `HomeScreen`'s `styles.card`. Widths vary
 * per card so the column doesn't look like a printed table. */
const SkeletonCard = (props: { readonly titleWidth: DimensionValue; readonly secondLine: boolean }): React.ReactElement => (
  <View style={styles.card}>
    <View style={[styles.bar, styles.title, { width: props.titleWidth }]} />
    {props.secondLine ? <View style={[styles.bar, styles.title, styles.titleSecond]} /> : null}
    <View style={styles.badgeRow}>
      <View style={[styles.bar, styles.pill]} />
      <View style={[styles.bar, styles.pill, styles.pillNarrow]} />
    </View>
    <View style={[styles.bar, styles.meta]} />
  </View>
);

const CARDS: ReadonlyArray<{ readonly titleWidth: DimensionValue; readonly secondLine: boolean }> = [
  { titleWidth: "72%", secondLine: true },
  { titleWidth: "54%", secondLine: false },
  { titleWidth: "66%", secondLine: true },
  { titleWidth: "48%", secondLine: false },
  { titleWidth: "60%", secondLine: false },
];

export const HomeSkeleton = (): React.ReactElement => {
  const pulse = React.useRef(new Animated.Value(0.5)).current;

  React.useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 750, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.5, duration: 750, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  return (
    <Animated.View style={{ opacity: pulse }} accessibilityLabel="Loading sessions">
      <View style={[styles.bar, styles.heading]} />
      {CARDS.map((card, index) => (
        <SkeletonCard key={index} titleWidth={card.titleWidth} secondLine={card.secondLine} />
      ))}
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  bar: {
    backgroundColor: colors.fillBackground,
    borderRadius: 6,
    overflow: "hidden",
  },
  heading: {
    width: 96,
    height: 13,
    marginTop: 22,
    marginBottom: 10,
    marginHorizontal: 16,
  },
  // Matches HomeScreen's `styles.card`.
  card: {
    marginHorizontal: 12,
    marginBottom: 10,
    padding: 14,
    borderRadius: 14,
    backgroundColor: colors.cardBackground,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.separator,
  },
  title: {
    height: 15,
  },
  titleSecond: {
    width: "40%",
    marginTop: 7,
  },
  badgeRow: {
    flexDirection: "row",
    gap: 6,
    marginTop: 10,
  },
  pill: {
    width: 58,
    height: 18,
    borderRadius: 999,
  },
  pillNarrow: {
    width: 42,
  },
  meta: {
    width: "28%",
    height: 10,
    marginTop: 10,
  },
});
