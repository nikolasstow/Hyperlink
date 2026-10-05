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
import Reanimated, { Easing, FadeIn, FadeOut, LayoutAnimationConfig, LinearTransition, type SharedValue, useAnimatedStyle, ZoomIn, ZoomOut } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FIELD_TINT_DARK, FIELD_TINT_LIGHT } from "../BottomBar";
import { colors } from "../colors";
import { iconForFile } from "../fileIcon";
import { SetiIcon } from "../SetiIcon";
import { setiDefaultGlyph, setiFolderGlyph } from "../setiIcons";
import { SystemIcon } from "../SystemIcon";
import { type TextColors, useTextColors, useThemedStyles } from "../theme";
import type { FileNavEntry, FilePlace, Visit } from "./FileNav";
import { isRootPath, shownPath, useFullPaths } from "./filePaths";
import { NAV_BAR_SIDE } from "./FileNavBar";
import { parentOf, type TabFilter, type TabLayout } from "./tabLayout";

import { TabPreview } from "./TabPreview";
import { PREVIEW_RADIUS } from "./tabShape";

/** The overview bar's pieces (its own: Files' bar is sized apart). */
const OVERVIEW_BAR_HEIGHT = 50;
/** Tabs coming, going and gliding in the grid. */
const GRID_MS = 300;
const GRID_EASING = Easing.bezier(0.2, 0.9, 0.25, 1);

const RoundButton = (props: { readonly icon: React.ComponentProps<typeof SystemIcon>["name"]; readonly label: string; readonly onPress: () => void }): React.ReactElement => {
  const styles = useThemedStyles(makeStyles);
  const textColors = useTextColors();
  const scheme = useColorScheme() === "dark" ? "dark" : "light";
  return (
    <GlassView style={styles.round} glassEffectStyle="clear" tintColor={scheme === "dark" ? FIELD_TINT_DARK : FIELD_TINT_LIGHT} colorScheme={scheme}>
      <Pressable style={styles.roundHit} accessibilityRole="button" accessibilityLabel={props.label} onPress={props.onPress}>
        <SystemIcon name={props.icon} size={20} weight="medium" color={textColors.label} />
      </Pressable>
    </GlassView>
  );
};

export const TabOverview = (props: {
  readonly place: FilePlace;
  readonly filter: TabFilter;
  readonly onFilter: (filter: TabFilter) => void;
  /** Where the grid is scrolled to as it opens (the tab it opened from in
   * view). It stays mounted, unseen, while Files is open (so opening it is
   * only the animation), so this is applied whenever it changes. */
  readonly scrollTarget: number;
  /** Whether it takes touches (open), or lies unseen under the page. */
  readonly interactive: boolean;
  readonly onScroll: (scroll: number) => void;
  /** The tab zooming in or out: its cell stays empty meanwhile. */
  readonly hiddenTab: number | undefined;
  readonly onSelect: (index: number) => void;
  readonly onClose: (index: number) => void;
  readonly onNew: () => void;
  readonly onOpenVisit: (entry: FileNavEntry) => void;
  readonly screen: { readonly width: number; readonly height: number };
  readonly topInset: number;
  /** Where everything in the grid is (tabLayout.ts). */
  readonly layout: TabLayout;
  /** The zoom (0 a tab at full screen, 1 in the grid): the grid fades in
   * with it, around the zooming tab. */
  readonly reveal: SharedValue<number>;
  /** The page's top inset, as the previews draw it. */
  readonly pageTop: number;

}): React.ReactElement => {
  const styles = useThemedStyles(makeStyles);
  const textColors = useTextColors();
  const insets = useSafeAreaInsets();
  const { layout, scrollTarget } = props;
  const scrollRef = React.useRef<ScrollView>(null);
  React.useLayoutEffect(() => {
    scrollRef.current?.scrollTo({ y: scrollTarget, animated: false });
  }, [scrollTarget]);
  const fullPaths = useFullPaths();
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const { onScroll } = props;
  const reportScroll = (event: NativeSyntheticEvent<NativeScrollEvent>): void => onScroll(event.nativeEvent.contentOffset.y);
  const { reveal } = props;
  const fade = useAnimatedStyle(() => ({ opacity: reveal.value }));
  const barAway = OVERVIEW_BAR_HEIGHT + 24 + insets.bottom;
  const barSlide = useAnimatedStyle(() => ({ bottom: insets.bottom - (1 - reveal.value) * barAway }));

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents={props.interactive ? "box-none" : "none"}>
      <Reanimated.View style={[StyleSheet.absoluteFill, fade]}>
      <ScrollView
        ref={scrollRef}
        style={StyleSheet.absoluteFill}
        onScroll={reportScroll}
        scrollEventThrottle={16}
        contentContainerStyle={{ height: layout.height + insets.bottom + OVERVIEW_BAR_HEIGHT + 40 }}
      >
        {/* No entering on the grid's first render: opening, it fades in with
          * the zoom; after that, tabs coming in do. */}
        <LayoutAnimationConfig skipEntering>
        <View style={StyleSheet.absoluteFill}>
          {/* A folder's group: its path above its tabs. */}
          {layout.headers.map((header) => (
            <Reanimated.View
              key={`header:${header.folder}`}
              style={[styles.header, { top: header.y, left: layout.side, right: layout.side, height: layout.headerHeight }]}
              entering={FadeIn.duration(GRID_MS)}
              exiting={FadeOut.duration(GRID_MS)}
              layout={LinearTransition.duration(GRID_MS).easing(GRID_EASING)}
            >
              <SystemIcon name="folder" size={13} color={textColors.secondaryLabel} />
              <Text style={styles.headerText} numberOfLines={1} ellipsizeMode="head">
                {shownPath(header.folder, props.place.root, fullPaths)}
              </Text>
            </Reanimated.View>
          ))}
          {layout.tabs.map(({ index, entry, x, y, grouped }) => (
            <Reanimated.View
              key={props.place.tabs[index]?.id ?? index}
              style={[styles.cell, { left: x, top: y, width: layout.cellWidth, height: layout.cellHeight }]}
              // Tabs coming (a new one, a filter) and going (closed, filtered
              // out) fade and scale; the rest glide to their places.
              entering={ZoomIn.duration(GRID_MS).easing(GRID_EASING)}
              exiting={ZoomOut.duration(GRID_MS).easing(GRID_EASING)}
              layout={LinearTransition.duration(GRID_MS).easing(GRID_EASING)}
            >
              {/* The preview at its exact size; its outline drawn over it (so it
                * shifts nothing), the close button in its corner. */}
              <View style={[styles.preview, { width: layout.cellWidth, height: layout.previewHeight }, props.hiddenTab === index && styles.hidden]}>
                <Pressable accessibilityRole="button" accessibilityLabel={`Open ${entry.name}`} onPress={() => props.onSelect(index)}>
                  <TabPreview entry={entry} width={layout.cellWidth} topInset={props.pageTop} />
                </Pressable>
                <View style={[styles.outline, index === props.place.active && styles.outlineActive]} pointerEvents="none" />
                <Pressable style={styles.close} accessibilityRole="button" accessibilityLabel={`Close ${entry.name}`} onPress={() => props.onClose(index)} hitSlop={10}>
                  <SystemIcon name="xmark" size={11} weight="bold" color={textColors.label} />
                </Pressable>
              </View>
              {/* Its type beside its name, as in the address pill; its folder
                * under it, unless its group's header says it (cut at its start:
                * its end matters most). */}
              <View style={styles.label}>
                <SetiIcon glyph={entry.kind === "directory" ? setiFolderGlyph ?? setiDefaultGlyph : iconForFile(entry.name).glyph} size={22} />
                <View style={styles.labelText}>
                  <Text style={styles.name} numberOfLines={1}>
                    {entry.name}
                  </Text>
                  {grouped || isRootPath(entry.path, props.place.root) ? null : (
                    <Text style={styles.path} numberOfLines={1} ellipsizeMode="head">
                      {shownPath(parentOf(entry.path), props.place.root, fullPaths)}
                    </Text>
                  )}
                </View>
              </View>
            </Reanimated.View>
          ))}
        </View>
        </LayoutAnimationConfig>
      </ScrollView>
      </Reanimated.View>
      {/* Its bar slides up in as the grid opens, and away as a tab grows
        * out of it (by layout: it is glass). */}
      <Reanimated.View style={[styles.bar, barSlide]} pointerEvents="box-none">
        <RoundButton icon="clock" label="History" onPress={() => setHistoryOpen(true)} />
        <Host style={styles.filterHost}>
          <Picker
            selection={props.filter}
            onSelectionChange={(next: TabFilter) => props.onFilter(next)}
            modifiers={[pickerStyle("segmented"), controlSize("extraLarge")]}
          >
            <UIText modifiers={[tag("all"), font({ size: 17, weight: "semibold" })]}>All</UIText>
            <UIImage systemName="doc" modifiers={[tag("files")]} />
            <UIImage systemName="folder" modifiers={[tag("folders")]} />
          </Picker>
        </Host>
        <RoundButton icon="plus" label="New tab" onPress={props.onNew} />
      </Reanimated.View>
      <History
        open={historyOpen}
        root={props.place.root}
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
  readonly root: string;
  readonly visits: ReadonlyArray<Visit>;
  readonly onClose: () => void;
  readonly onOpen: (entry: FileNavEntry) => void;
}): React.ReactElement => {
  const fullPaths = useFullPaths();
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
              {isRootPath(item.entry.path, props.root) ? null : (
                <Text style={styles.path} numberOfLines={1} ellipsizeMode="head">
                  {shownPath(parentOf(item.entry.path), props.root, fullPaths)}
                </Text>
              )}
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
    cell: {
      position: "absolute",
    },
    header: {
      position: "absolute",
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
    },
    headerText: {
      flex: 1,
      color: text.secondaryLabel,
      fontSize: 13,
      fontWeight: "600",
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
    label: {
      flexDirection: "row",
      alignItems: "center",
      gap: 7,
      marginTop: 6,
    },
    labelText: {
      flex: 1,
    },
    name: {
      color: text.label,
      fontSize: 13,
      fontWeight: "600",
    },
    path: {
      color: text.secondaryLabel,
      fontSize: 11,
    },
    // In from the sides as Files' own bar is (its side margin).
    bar: {
      position: "absolute",
      left: NAV_BAR_SIDE,
      right: NAV_BAR_SIDE,
      height: OVERVIEW_BAR_HEIGHT + 16,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    round: {
      width: OVERVIEW_BAR_HEIGHT,
      height: OVERVIEW_BAR_HEIGHT,
      borderRadius: OVERVIEW_BAR_HEIGHT / 2,
    },
    roundHit: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
    },
    filterHost: {
      width: 230,
      height: OVERVIEW_BAR_HEIGHT,
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
