/**
 * A favorited file or folder on Home — a location (not a page), shown as a
 * full-width glass row that reopens it in Files. Fixed height (nothing
 * measured).
 *
 * @internal
 */
import { GlassView } from "expo-glass-effect";
import * as React from "react";
import { Pressable, StyleSheet, Text, useColorScheme, View } from "react-native";
import { colors } from "./colors";
import { FAV_LOCATION_CARD_HEIGHT } from "./home/homeLayout";
import { SystemIcon } from "./SystemIcon";
import { type TextColors, useTextColors, useThemedStyles } from "./theme";

const CARD_GUTTER = 12;
const CARD_GAP = 10;

export interface FavoriteLocationCardProps {
  readonly name: string;
  /** The parent folder, shown under the name. */
  readonly folder: string;
  readonly isFolder: boolean;
  readonly onOpen: () => void;
}

export const FavoriteLocationCard = (props: FavoriteLocationCardProps): React.ReactElement => {
  const styles = useThemedStyles(makeStyles);
  const textColors = useTextColors();
  const scheme = useColorScheme() === "dark" ? "dark" : "light";
  return (
    <Pressable style={styles.shadow} onPress={props.onOpen} accessibilityRole="button" accessibilityLabel={`Open ${props.name}`}>
      <GlassView style={styles.card} glassEffectStyle="regular" colorScheme={scheme}>
        <SystemIcon name={props.isFolder ? "folder" : "doc.text"} size={18} color={colors.tint} />
        <View style={styles.text}>
          <Text style={styles.name} numberOfLines={1}>
            {props.name}
          </Text>
          <Text style={styles.folder} numberOfLines={1}>
            {props.folder}
          </Text>
        </View>
        <SystemIcon name="chevron.right" size={14} color={textColors.secondaryLabel} />
      </GlassView>
    </Pressable>
  );
};

const makeStyles = (text: TextColors) =>
  StyleSheet.create({
    shadow: {
      marginHorizontal: CARD_GUTTER,
      marginBottom: CARD_GAP,
      borderRadius: 14,
      shadowColor: "#000000",
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.08,
      shadowRadius: 6,
    },
    card: {
      height: FAV_LOCATION_CARD_HEIGHT,
      borderRadius: 14,
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      paddingHorizontal: 14,
    },
    text: {
      flex: 1,
    },
    name: {
      color: text.label,
      fontSize: 16,
      fontWeight: "600",
    },
    folder: {
      color: text.secondaryLabel,
      fontSize: 12,
      marginTop: 1,
    },
  });
