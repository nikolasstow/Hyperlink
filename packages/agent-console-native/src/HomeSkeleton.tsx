/**
 * Home before it is up (the launch screen, and Home while it has no list):
 * Home's last layout as blank cards, its headings real, each card at the size
 * Home worked out for it (home/homeLayout.ts), so the column is where Home's
 * will be and nothing jumps when Home takes over. Before Home has ever kept a
 * layout: "Recent" and a few medium cards.
 *
 * The cards look like glass cards whose glass is not drawn (as in the app
 * switcher), as sampled from it (colors.ts): its fill, and in light mode its
 * edge, two pixels wide. They
 * stay still, as that glass does (a pulse washed them out).
 *
 * @internal
 */
import * as React from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors } from "./colors";
import { CARD_GAP, CARD_GUTTER, FAV_LOCATION_CARD_HEIGHT, type HomeLayout, type HomeRow, REPO_CARD_HEIGHT, SERVER_CARD_HEIGHT, SESSION_CARD_HEIGHT } from "./home/homeLayout";
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
  row.kind === "session"
    ? SESSION_CARD_HEIGHT[row.size]
    : row.kind === "server"
      ? SERVER_CARD_HEIGHT
      : row.kind === "favLocation"
        ? FAV_LOCATION_CARD_HEIGHT
        : row.latest
          ? REPO_CARD_HEIGHT.latest
          : REPO_CARD_HEIGHT.plain;

export const HomeSkeleton = (): React.ReactElement => {
  const styles = useThemedStyles(makeStyles);
  const kept = useKeptHomeLayout();
  // Until it is read back (a moment), nothing: drawing the first-launch
  // cards meanwhile would change under you.
  const layout = kept === undefined ? [] : kept.length === 0 ? FIRST_LAUNCH : kept;

  return (
    <View accessibilityLabel="Loading sessions">
      {layout.map((row, index) =>
        row.kind === "heading" ? (
          <Text key={index} style={[styles.heading, row.first && styles.headingFirst]}>
            {row.title}
          </Text>
        ) : (
          <View key={index} style={[styles.card, { height: heightOf(row) }]} />
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
      borderWidth: StyleSheet.hairlineWidth * 2,
      borderColor: colors.glassStandInEdge,
    },
  });
