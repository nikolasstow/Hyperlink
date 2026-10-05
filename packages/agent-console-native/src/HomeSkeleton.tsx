/**
 * Home before it is up (the launch screen, and Home while it has no list):
 * Home's last layout as blank cards, its headings real, each card at the size
 * Home worked out for it (home/homeLayout.ts), so the column is where Home's
 * will be and nothing jumps when Home takes over. Before Home has ever kept a
 * layout: "Recent" and a few medium cards.
 *
 * The cards look like glass cards whose glass is not drawn (as in the app
 * switcher), and pulse (opacity, on the native driver; they are plain
 * fills, not glass); the headings stay still.
 *
 * @internal
 */
import * as React from "react";
import { Animated, StyleSheet, Text, View } from "react-native";
import { colors } from "./colors";
import { CARD_GAP, CARD_GUTTER, type HomeLayout, type HomeRow, REPO_CARD_HEIGHT, SESSION_CARD_HEIGHT } from "./home/homeLayout";
import { useKeptHomeLayout } from "./home/useHomeLayout";
import { type TextColors, useThemedStyles } from "./theme";

const FIRST_LAUNCH: HomeLayout = [
  { kind: "heading", title: "Recent", first: true },
  { kind: "session", size: "medium" },
  { kind: "session", size: "medium" },
  { kind: "session", size: "medium" },
  { kind: "session", size: "medium" },
];

const heightOf = (row: Exclude<HomeRow, { readonly kind: "heading" }>): number =>
  row.kind === "session" ? SESSION_CARD_HEIGHT[row.size] : row.latest ? REPO_CARD_HEIGHT.latest : REPO_CARD_HEIGHT.plain;

export const HomeSkeleton = (): React.ReactElement => {
  const styles = useThemedStyles(makeStyles);
  const kept = useKeptHomeLayout();
  // Until it is read back (a moment), nothing: drawing the first-launch
  // cards meanwhile would change under you.
  const layout = kept === undefined ? [] : kept.length === 0 ? FIRST_LAUNCH : kept;
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
      {layout.map((row, index) =>
        row.kind === "heading" ? (
          <Text key={index} style={[styles.heading, row.first && styles.headingFirst]}>
            {row.title}
          </Text>
        ) : (
          <Animated.View key={index} style={[styles.card, { height: heightOf(row), opacity: pulse }]} />
        ),
      )}
    </View>
  );
};

const makeStyles = (text: TextColors) =>
  StyleSheet.create({
    // HomeScreen's `heading` and `headingFirst`, so each lands where Home's
    // does.
    heading: {
      color: text.secondaryLabel,
      fontSize: 15,
      fontWeight: "400",
      marginTop: 22,
      marginBottom: 10,
      marginHorizontal: 16,
    },
    headingFirst: {
      marginTop: 4,
    },
    // The look of a glass card whose glass is not drawn (out of focus): the
    // cards it stands in for.
    card: {
      marginHorizontal: CARD_GUTTER,
      marginBottom: CARD_GAP,
      borderRadius: 14,
      borderCurve: "continuous",
      backgroundColor: colors.glassStandIn,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.glassStandInEdge,
    },
  });
