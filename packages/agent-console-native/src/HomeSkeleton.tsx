/**
 * The Home screen's loading state: the real "Recent" section label with
 * placeholder cards under it, mirroring the actual session/repo layout so the
 * transition is seamless — the label stays put and the cards just fill in,
 * rather than the whole column shifting.
 *
 * The label is real (not skeletonized) and doesn't pulse; only the cards pulse.
 * Fills use `tertiarySystemFill` (via `colors.fillBackground`) so it's
 * theme-aware, and the pulse runs on the native driver.
 *
 * @internal
 */
import * as React from "react";
import { Animated, StyleSheet, Text, View } from "react-native";
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
    <View accessibilityLabel="Loading sessions">
      <Text style={styles.heading}>Recent</Text>
      <Animated.View style={{ opacity: pulse }}>
        {CARDS.map((card, index) => (
          <SkeletonCard key={index} titleWidth={card.titleWidth} secondLine={card.secondLine} />
        ))}
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  bar: {
    backgroundColor: colors.fillBackground,
    borderRadius: 6,
    overflow: "hidden",
  },
  // Matches HomeScreen's `heading` + `headingFirst` exactly, so the real
  // "Recent" heading lands in the same spot when data replaces the skeleton.
  heading: {
    color: colors.secondaryLabel,
    fontSize: 15,
    fontWeight: "400",
    marginTop: 4,
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
