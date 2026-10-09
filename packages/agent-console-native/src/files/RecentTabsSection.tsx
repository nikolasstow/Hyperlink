/**
 * Home's recent tabs: the files opened most recently across every repo's Files
 * (recentTabs.ts), as a two-column grid of glass cells under the recent
 * sessions. A tap reopens the file in a new Files tab. Fixed sizes (nothing
 * measured).
 *
 * @internal
 */
import { GlassView } from "expo-glass-effect";
import * as React from "react";
import { Pressable, StyleSheet, Text, useColorScheme, useWindowDimensions, View } from "react-native";
import { iconForFile } from "../fileIcon";
import { SetiIcon } from "../SetiIcon";
import { setiDefaultGlyph, setiFolderGlyph } from "../setiIcons";
import { type TextColors, useThemedStyles } from "../theme";
import { parentOf } from "./tabLayout";
import type { RecentTab } from "./recentTabs";
import { ContextMenuView } from "../../modules/context-menu";
import { fileTarget, folderTarget, sameTarget } from "../favorites/model";
import { toggleFavorite, useBoard, useFavoriteScope } from "../favorites/useFavorites";

const GUTTER = 12;
const GAP = 10;
const CELL_HEIGHT = 56;

export const RecentTabsSection = (props: { readonly tabs: ReadonlyArray<RecentTab>; readonly onOpen: (tab: RecentTab) => void }): React.ReactElement => {
  const styles = useThemedStyles(makeStyles);
  const scheme = useColorScheme() === "dark" ? "dark" : "light";
  const { width } = useWindowDimensions();
  const cellWidth = (width - GUTTER * 2 - GAP) / 2;
  // A hard press favorites a recent file/folder to the surface's scope (Home).
  const scope = useFavoriteScope();
  const board = useBoard(scope);
  return (
    <View style={styles.grid}>
      {props.tabs.map((tab) => {
        const folder = parentOf(tab.entry.path).split("/").filter(Boolean).pop() ?? tab.repo;
        const target = tab.entry.kind === "directory" ? folderTarget(tab.repo, tab.entry.path, tab.entry.name) : fileTarget(tab.repo, tab.entry.path, tab.entry.name);
        const isFav = board.some((each) => sameTarget(each, target));
        return (
          <ContextMenuView
            key={`${tab.repo}:${tab.entry.path}`}
            style={[styles.shadow, { width: cellWidth }]}
            previewCornerRadius={14}
            actions={[{ id: "favorite", title: isFav ? "Unfavorite" : "Favorite", systemImage: isFav ? "star.slash" : "star" }]}
            onAction={(id) => {
              if (id === "favorite") void toggleFavorite(scope, target);
            }}
          >
            <Pressable onPress={() => props.onOpen(tab)} accessibilityRole="button" accessibilityLabel={`Open ${tab.entry.name}`}>
              <GlassView style={styles.cell} glassEffectStyle="regular" colorScheme={scheme}>
                <SetiIcon glyph={tab.entry.kind === "directory" ? setiFolderGlyph ?? setiDefaultGlyph : iconForFile(tab.entry.name).glyph} size={22} />
                <View style={styles.text}>
                  <Text style={styles.name} numberOfLines={1}>
                    {tab.entry.name}
                  </Text>
                  <Text style={styles.folder} numberOfLines={1}>
                    {folder}
                  </Text>
                </View>
              </GlassView>
            </Pressable>
          </ContextMenuView>
        );
      })}
    </View>
  );
};

const makeStyles = (text: TextColors) =>
  StyleSheet.create({
    grid: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: GAP,
      paddingHorizontal: GUTTER,
    },
    shadow: {
      borderRadius: 14,
      shadowColor: "#000000",
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.08,
      shadowRadius: 6,
    },
    cell: {
      height: CELL_HEIGHT,
      borderRadius: 14,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingHorizontal: 12,
    },
    text: {
      flex: 1,
    },
    name: {
      color: text.label,
      fontSize: 14,
      fontWeight: "600",
    },
    folder: {
      color: text.secondaryLabel,
      fontSize: 11,
    },
  });
