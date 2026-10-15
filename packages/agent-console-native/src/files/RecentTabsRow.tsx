/**
 * A repo's three most recent tabs (FileNav `recentTabs`), as small previews
 * in a row above its root's files: the page Files opens on from the repo's
 * Files button, so a recent tab is one tap away. Each looks as it does in the
 * tab overview, at a third of the width. Fixed sizes (nothing measured).
 *
 * @internal
 */
import * as React from "react";
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { colors } from "../colors";
import { iconForFile } from "../fileIcon";
import { SetiIcon } from "../SetiIcon";
import { setiDefaultGlyph, setiFolderGlyph } from "../setiIcons";
import { type TextColors, useThemedStyles } from "../theme";
import type { FileNavEntry } from "./FileNav";
import { TabPreview } from "./TabPreview";
import { PREVIEW_ASPECT, PREVIEW_RADIUS } from "./tabShape";

/** How many tabs the row shows. */
export const RECENT_TAB_COUNT = 3;
const GAP = 10;
/** The listing's side padding (FileListing), which the row sits inside. */
const SIDE = 14;

export const RecentTabsRow = (props: {
  /** The tabs shown, newest first: each tab's index and the entry it shows. */
  readonly tabs: ReadonlyArray<{ readonly index: number; readonly entry: FileNavEntry }>;
  /** Room at a page's top, as the previews draw it. */
  readonly pageTop: number;
  readonly onSelect: (index: number) => void;
}): React.ReactElement | null => {
  const styles = useThemedStyles(makeStyles);
  const { width: screenWidth } = useWindowDimensions();
  const cellWidth = (screenWidth - SIDE * 2 - GAP * (RECENT_TAB_COUNT - 1)) / RECENT_TAB_COUNT;
  if (props.tabs.length === 0) return null;
  return (
    <View style={styles.row}>
      {props.tabs.map(({ index, entry }) => (
        <Pressable key={`${index}:${entry.path}`} style={{ width: cellWidth }} accessibilityRole="button" accessibilityLabel={`Open tab ${entry.name}`} onPress={() => props.onSelect(index)}>
          <View style={[styles.preview, { width: cellWidth, height: cellWidth * PREVIEW_ASPECT }]}>
            <TabPreview entry={entry} width={cellWidth} topInset={props.pageTop} />
            <View style={styles.outline} pointerEvents="none" />
          </View>
          <View style={styles.label}>
            <SetiIcon glyph={entry.kind === "directory" ? setiFolderGlyph ?? setiDefaultGlyph : iconForFile(entry.name).glyph} size={16} />
            <Text style={styles.name} numberOfLines={1}>
              {entry.name}
            </Text>
          </View>
        </Pressable>
      ))}
    </View>
  );
};

const makeStyles = (text: TextColors) =>
  StyleSheet.create({
    // Room above (under the header) and below (before the files).
    row: {
      flexDirection: "row",
      gap: GAP,
      marginTop: 12,
      marginBottom: 20,
    },
    preview: {
      borderRadius: PREVIEW_RADIUS,
      borderCurve: "continuous",
      overflow: "hidden",
    },
    outline: {
      ...StyleSheet.absoluteFill,
      borderRadius: PREVIEW_RADIUS,
      borderCurve: "continuous",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.separator,
    },
    label: {
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
      marginTop: 5,
    },
    name: {
      flex: 1,
      color: text.label,
      fontSize: 12,
      fontWeight: "600",
    },
  });
