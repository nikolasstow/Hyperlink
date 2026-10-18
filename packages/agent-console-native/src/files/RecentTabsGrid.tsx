/**
 * A repo's most recent tabs (FileNav `recentTabs`), as small previews in a
 * grid of up to two rows of three above its root's files: the page Files
 * opens on from the repo's Files button, so a recent tab is one tap away.
 * Each looks as it does in the tab overview, at a third of the width. When
 * not every tab fits, the last cell is All tabs (+ the tabs not shown), which opens
 * the tab overview (docs/handoffs/files-redesign-notes.md). Fixed sizes
 * (nothing measured).
 *
 * @internal
 */
import * as React from "react";
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { colors } from "../colors";
import { iconForFile } from "../fileIcon";
import { SetiIcon } from "../SetiIcon";
import { SystemIcon } from "../SystemIcon";
import { setiDefaultGlyph, setiFolderGlyph } from "../setiIcons";
import { type TextColors, useScreenBackground, useTextColors, useThemedStyles } from "../theme";
import { type FileNavEntry, TAB_GRID_COLUMNS, tabGridOf } from "./FileNav";
import { TabPreview } from "./TabPreview";
import { PREVIEW_ASPECT, PREVIEW_RADIUS } from "./tabShape";

const GAP = 10;
/** The listing's side padding (FileListing), which the grid sits inside. */
const SIDE = 14;

export const RecentTabsGrid = (props: {
  /** The most recent tabs, newest first: each tab's index and the entry it
   * shows (`RECENT_TAB_COUNT` at most). */
  readonly tabs: ReadonlyArray<{ readonly index: number; readonly entry: FileNavEntry }>;
  /** How many tabs the repo has (those in its worktrees). */
  readonly total: number;
  /** Room at a page's top, as the previews draw it. */
  readonly pageTop: number;
  readonly onSelect: (index: number) => void;
  /** Opens the tab overview (All tabs). */
  readonly onAllTabs: () => void;
}): React.ReactElement | null => {
  const styles = useThemedStyles(makeStyles);
  const textColors = useTextColors();
  const { width: screenWidth } = useWindowDimensions();
  const background = useScreenBackground("plain");
  const cellWidth = (screenWidth - SIDE * 2 - GAP * (TAB_GRID_COLUMNS - 1)) / TAB_GRID_COLUMNS;
  if (props.tabs.length === 0) return null;
  const grid = tabGridOf(props.total);
  const cells: ReadonlyArray<React.ReactElement> = [
    ...props.tabs.slice(0, grid.previews).map(({ index, entry }) => (
      <Pressable key={`${index}:${entry.path}`} style={{ width: cellWidth }} accessibilityRole="button" accessibilityLabel={`Open tab ${entry.name}`} onPress={() => props.onSelect(index)}>
        {/* The shadow outside the preview's clip (which would cut it off). */}
        <View style={[styles.shadow, { width: cellWidth, height: cellWidth * PREVIEW_ASPECT, backgroundColor: background }]}>
          <View style={[styles.preview, { width: cellWidth, height: cellWidth * PREVIEW_ASPECT }]}>
            <TabPreview entry={entry} width={cellWidth} topInset={props.pageTop} />
            <View style={styles.outline} pointerEvents="none" />
          </View>
        </View>
        <View style={styles.label}>
          <SetiIcon glyph={entry.kind === "directory" ? setiFolderGlyph ?? setiDefaultGlyph : iconForFile(entry.name).glyph} size={16} />
          <Text style={styles.name} numberOfLines={1}>
            {entry.name}
          </Text>
        </View>
      </Pressable>
    )),
    ...(grid.allTabs
      ? [
          <Pressable key="all-tabs" style={{ width: cellWidth }} accessibilityRole="button" accessibilityLabel={`All tabs, ${props.total - grid.previews} more`} onPress={props.onAllTabs}>
            <View style={[styles.shadow, { width: cellWidth, height: cellWidth * PREVIEW_ASPECT, backgroundColor: background }]}>
              <View style={[styles.preview, styles.allTabs, { width: cellWidth, height: cellWidth * PREVIEW_ASPECT }]}>
                <SystemIcon name="square.on.square" size={28} weight="medium" color={textColors.label} />
                <Text style={styles.count}>{`+${props.total - grid.previews}`}</Text>
                <View style={styles.outline} pointerEvents="none" />
              </View>
            </View>
            <View style={styles.label}>
              <Text style={styles.name} numberOfLines={1}>
                All tabs
              </Text>
            </View>
          </Pressable>,
        ]
      : []),
  ];
  // Rows of three made here, not by wrapping: cells of a third's width
  // (fractional) can overflow a row when rounded to pixels, and wrap early.
  const rows = Array.from({ length: Math.ceil(cells.length / TAB_GRID_COLUMNS) }, (_, row) => cells.slice(row * TAB_GRID_COLUMNS, (row + 1) * TAB_GRID_COLUMNS));
  return (
    <View style={styles.grid}>
      {rows.map((row, at) => (
        <View key={at} style={styles.row}>
          {row}
        </View>
      ))}
    </View>
  );
};

const makeStyles = (text: TextColors) =>
  StyleSheet.create({
    // Room above (under the header) and below (before the files).
    grid: {
      gap: GAP,
      marginTop: 12,
      marginBottom: 20,
    },
    row: {
      flexDirection: "row",
      gap: GAP,
    },
    shadow: {
      borderRadius: PREVIEW_RADIUS,
      borderCurve: "continuous",
      shadowColor: "#000000",
      shadowOffset: { width: 0, height: 3 },
      shadowOpacity: 0.14,
      shadowRadius: 8,
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
    allTabs: {
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
      backgroundColor: colors.fillBackground,
    },
    count: {
      color: text.label,
      fontSize: 20,
      fontWeight: "600",
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
