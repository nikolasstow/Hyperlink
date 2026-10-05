/**
 * Files' tab overview, as Safari's: every tab as a preview in a two-column
 * grid, its name under it and as much of its path as fits, cut at the start
 * (the end matters most). Tapping a preview opens that tab (FilesScreen zooms
 * it out to full); its corner button closes it. The bottom bar: history at the
 * left, All · Files · Folders in the middle (a native segmented control), a +
 * at the right for a new tab.
 *
 * Its geometry is fixed (`overviewGeometry`), so FilesScreen knows where each
 * preview sits on the screen without measuring, for the zoom in and out.
 * Decisions: docs/handoffs/files-redesign-notes.md §9–§10.
 *
 * @internal
 */
import { Host, Image as UIImage, Picker, Text as UIText } from "@expo/ui/swift-ui";
import { controlSize, font, pickerStyle, tag } from "@expo/ui/swift-ui/modifiers";
import { GlassView } from "expo-glass-effect";
import * as React from "react";
import { FlatList, Modal as RNModal, type NativeScrollEvent, type NativeSyntheticEvent, Pressable, ScrollView, StyleSheet, Text, useColorScheme, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FIELD_TINT_DARK, FIELD_TINT_LIGHT } from "../BottomBar";
import { colors } from "../colors";
import { SystemIcon } from "../SystemIcon";
import { type TextColors, useTextColors, useThemedStyles } from "../theme";
import { type FileNavEntry, type FilePlace, tabEntry, type Visit } from "./FileNav";
import { NAV_BAR_BOTTOM, NAV_BAR_HEIGHT, NAV_BAR_SIDE } from "./FileNavBar";
import { TabPreview } from "./TabPreview";
import { PREVIEW_ASPECT, PREVIEW_RADIUS } from "./tabShape";

export type TabFilter = "all" | "files" | "folders";

/** The tabs a filter shows, with their places among all tabs. */
export const filteredTabs = (place: FilePlace, filter: TabFilter): ReadonlyArray<{ readonly index: number; readonly entry: FileNavEntry }> =>
  place.tabs.flatMap((tab, index) => {
    const entry = tabEntry(tab);
    if (entry === undefined) return [];
    if (filter === "files" && entry.kind !== "file") return [];
    if (filter === "folders" && entry.kind !== "directory") return [];
    return [{ index, entry }];
  });

const SIDE = 16;

const GAP = 14;

/** Under each preview: its name and its path. */
const LABEL_HEIGHT = 40;
const ROW_GAP = 18;

/** Where the grid's cells are, from the screen's size alone. */
export const overviewGeometry = (screen: { readonly width: number; readonly height: number }, topInset: number) => {
  const cellWidth = (screen.width - SIDE * 2 - GAP) / 2;
  // Safari's shape: 3:4, the page's top (cropped).
  const previewHeight = cellWidth * PREVIEW_ASPECT;
  const rowHeight = previewHeight + LABEL_HEIGHT + ROW_GAP;
  const top = topInset + 12;
  return {
    cellWidth,
    previewHeight,
    rowHeight,
    top,
    /** A cell's preview on the screen, with the grid scrolled `scroll` down. */
    previewAt: (position: number, scroll: number) => ({
      x: SIDE + (position % 2) * (cellWidth + GAP),
      y: top + Math.floor(position / 2) * rowHeight - scroll,
      width: cellWidth,
      height: previewHeight,
    }),
  };
};

const RoundButton = (props: { readonly icon: React.ComponentProps<typeof SystemIcon>["name"]; readonly label: string; readonly onPress: () => void }): React.ReactElement => {
  const styles = useThemedStyles(makeStyles);
  const textColors = useTextColors();
  const scheme = useColorScheme() === "dark" ? "dark" : "light";
  return (
    <GlassView style={styles.round} glassEffectStyle="clear" tintColor={scheme === "dark" ? FIELD_TINT_DARK : FIELD_TINT_LIGHT} colorScheme={scheme}>
      <Pressable style={styles.roundHit} accessibilityRole="button" accessibilityLabel={props.label} onPress={props.onPress}>
        <SystemIcon name={props.icon} size={16} weight="medium" color={textColors.label} />
      </Pressable>
    </GlassView>
  );
};

export const TabOverview = (props: {
  readonly place: FilePlace;
  readonly filter: TabFilter;
  readonly onFilter: (filter: TabFilter) => void;
  /** Where the grid starts scrolled (so the tab it opened from is in view). */
  readonly initialScroll: number;
  readonly onScroll: (scroll: number) => void;
  /** The tab zooming in or out: its cell stays empty meanwhile. */
  readonly hiddenTab: number | undefined;
  readonly onSelect: (index: number) => void;
  readonly onClose: (index: number) => void;
  readonly onNew: () => void;
  readonly onOpenVisit: (entry: FileNavEntry) => void;
  readonly screen: { readonly width: number; readonly height: number };
  readonly topInset: number;
}): React.ReactElement => {
  const styles = useThemedStyles(makeStyles);
  const textColors = useTextColors();
  const insets = useSafeAreaInsets();
  const geometry = overviewGeometry(props.screen, props.topInset);
  const tabs = filteredTabs(props.place, props.filter);
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const { onScroll } = props;
  const reportScroll = (event: NativeSyntheticEvent<NativeScrollEvent>): void => onScroll(event.nativeEvent.contentOffset.y);

  return (
    <View style={StyleSheet.absoluteFill}>
      <ScrollView
        style={StyleSheet.absoluteFill}
        contentOffset={{ x: 0, y: props.initialScroll }}
        onScroll={reportScroll}
        scrollEventThrottle={16}
        contentContainerStyle={{ paddingTop: geometry.top, paddingBottom: insets.bottom + NAV_BAR_HEIGHT + 40, paddingHorizontal: SIDE }}
      >
        <View style={styles.grid}>
          {tabs.map(({ index, entry }) => (
            <View key={props.place.tabs[index]?.id ?? index} style={[styles.cell, { width: geometry.cellWidth, height: geometry.rowHeight - ROW_GAP }]}>
              {/* The preview at its exact size; its outline drawn over it (so it
                * shifts nothing), the close button in its corner. */}
              <View style={[styles.preview, { width: geometry.cellWidth, height: geometry.previewHeight }, props.hiddenTab === index && styles.hidden]}>
                <Pressable accessibilityRole="button" accessibilityLabel={`Open ${entry.name}`} onPress={() => props.onSelect(index)}>
                  <TabPreview entry={entry} width={geometry.cellWidth} topInset={props.topInset} />
                </Pressable>
                <View style={[styles.outline, index === props.place.active && styles.outlineActive]} pointerEvents="none" />
                <Pressable style={styles.close} accessibilityRole="button" accessibilityLabel={`Close ${entry.name}`} onPress={() => props.onClose(index)} hitSlop={10}>
                  <SystemIcon name="xmark" size={11} weight="bold" color={textColors.label} />
                </Pressable>
              </View>
              <Text style={styles.name} numberOfLines={1}>
                {entry.name}
              </Text>
              {/* The path, cut at its start: its end matters most. */}
              <Text style={styles.path} numberOfLines={1} ellipsizeMode="head">
                {entry.path}
              </Text>
            </View>
          ))}
        </View>
      </ScrollView>
      <View style={[styles.bar, { bottom: insets.bottom + NAV_BAR_BOTTOM - 8 }]} pointerEvents="box-none">
        <RoundButton icon="clock" label="History" onPress={() => setHistoryOpen(true)} />
        <Host style={styles.filterHost}>
          <Picker
            selection={props.filter}
            onSelectionChange={(next: TabFilter) => props.onFilter(next)}
            modifiers={[pickerStyle("segmented"), controlSize("large")]}
          >
            <UIText modifiers={[tag("all"), font({ size: 15, weight: "semibold" })]}>All</UIText>
            <UIImage systemName="doc" modifiers={[tag("files")]} />
            <UIImage systemName="folder" modifiers={[tag("folders")]} />
          </Picker>
        </Host>
        <RoundButton icon="plus" label="New tab" onPress={props.onNew} />
      </View>
      <History
        open={historyOpen}
        visits={props.place.history}
        onClose={() => setHistoryOpen(false)}
        onOpen={(entry) => {
          setHistoryOpen(false);
          props.onOpenVisit(entry);
        }}
      />
    </View>
  );
};

/** Everything opened in this repo's Files, newest first; a tap opens it in a
 * new tab. A native sheet. */
const History = (props: {
  readonly open: boolean;
  readonly visits: ReadonlyArray<Visit>;
  readonly onClose: () => void;
  readonly onOpen: (entry: FileNavEntry) => void;
}): React.ReactElement => {
  const styles = useThemedStyles(makeStyles);
  return (
    <ModalSheet open={props.open} onClose={props.onClose}>
      <Text style={styles.sheetTitle}>History</Text>
      <FlatList
        data={props.visits}
        keyExtractor={(visit) => visit.entry.path}
        ListEmptyComponent={<Text style={styles.empty}>Nothing opened yet.</Text>}
        renderItem={({ item }) => (
          <Pressable style={styles.visit} onPress={() => props.onOpen(item.entry)}>
            <SystemIcon name={item.entry.kind === "directory" ? "folder" : "doc.text"} size={16} color={colors.tint} />
            <View style={styles.visitText}>
              <Text style={styles.name} numberOfLines={1}>
                {item.entry.name}
              </Text>
              <Text style={styles.path} numberOfLines={1} ellipsizeMode="head">
                {item.entry.path}
              </Text>
            </View>
          </Pressable>
        )}
      />
    </ModalSheet>
  );
};

/** iOS's own page sheet. */
const ModalSheet = (props: { readonly open: boolean; readonly onClose: () => void; readonly children: React.ReactNode }): React.ReactElement => {
  const styles = useThemedStyles(makeStyles);
  return (
    <RNModal visible={props.open} presentationStyle="pageSheet" animationType="slide" onRequestClose={props.onClose}>
      <View style={styles.sheet}>{props.children}</View>
    </RNModal>
  );
};

const makeStyles = (text: TextColors) =>
  StyleSheet.create({
    grid: {
      flexDirection: "row",
      flexWrap: "wrap",
      columnGap: GAP,
      rowGap: ROW_GAP,
    },
    cell: {
      gap: 4,
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
    outlineActive: {
      borderWidth: 2.5,
      borderColor: colors.tint,
    },
    hidden: {
      opacity: 0,
    },
    close: {
      position: "absolute",
      top: 8,
      right: 8,
      width: 24,
      height: 24,
      borderRadius: 12,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.glassStandIn,
    },
    name: {
      color: text.label,
      fontSize: 13,
      fontWeight: "600",
      marginTop: 4,
    },
    path: {
      color: text.secondaryLabel,
      fontSize: 11,
    },
    bar: {
      position: "absolute",
      left: NAV_BAR_SIDE,
      right: NAV_BAR_SIDE,
      height: NAV_BAR_HEIGHT + 16,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    round: {
      width: NAV_BAR_HEIGHT,
      height: NAV_BAR_HEIGHT,
      borderRadius: NAV_BAR_HEIGHT / 2,
    },
    roundHit: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
    },
    filterHost: {
      width: 190,
      height: NAV_BAR_HEIGHT,
    },
    sheet: {
      flex: 1,
      paddingTop: 20,
    },
    sheetTitle: {
      color: text.label,
      fontSize: 17,
      fontWeight: "600",
      textAlign: "center",
      marginBottom: 12,
    },
    empty: {
      color: text.secondaryLabel,
      textAlign: "center",
      marginTop: 40,
    },
    visit: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      paddingHorizontal: 20,
      paddingVertical: 10,
    },
    visitText: {
      flex: 1,
    },
  });
