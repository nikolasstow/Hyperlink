/**
 * Files' tab overview, as Safari's: every tab as a preview in a two-column
 * grid, its name under it and as much of its path as fits, cut at the start
 * (the end matters most). Tapping a preview opens that tab (FilesScreen zooms
 * it out to full); its corner button closes it. The bottom bar: a + at the
 * left for a new tab, All · Files · Folders in the middle (a native segmented
 * control), Done at the right (blue: back into the tab showing).
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
import { type NativeScrollEvent, type NativeSyntheticEvent, Pressable, ScrollView, StyleSheet, Text, useColorScheme, View } from "react-native";
import Reanimated, { Easing, FadeIn, FadeOut, LayoutAnimationConfig, LinearTransition, type SharedValue, useAnimatedStyle, ZoomIn, ZoomOut } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FIELD_TINT_DARK, FIELD_TINT_LIGHT } from "../BottomBar";
import { colors } from "../colors";
import { iconForFile } from "../fileIcon";
import { SetiIcon } from "../SetiIcon";
import { setiDefaultGlyph, setiFolderGlyph } from "../setiIcons";
import { SystemIcon } from "../SystemIcon";
import { type TextColors, useTextColors, useThemedStyles } from "../theme";

import { isRootPath, shownPath, useFullPaths } from "./filePaths";
import { useMissingPaths } from "./missingPaths";
import { PILL_HEIGHT } from "../titlePillStyle";
import { NAV_BAR_SIDE } from "./FileNavBar";
import { parentOf, sameTab, type TabFilter, type TabLayout, type TabRef } from "./tabLayout";

import { TabPreview } from "./TabPreview";
import { PREVIEW_RADIUS } from "./tabShape";

/** The overview bar's pieces (its own: Files' bar is sized apart). */
const OVERVIEW_BAR_HEIGHT = 50;
/** Room at the top for its top button (the title pill's height) and a gap
 * under it, above the grid. */
export const OVERVIEW_TOP_ROOM = PILL_HEIGHT + 10;
/** Tabs coming, going and gliding in the grid. */
const GRID_MS = 300;
const GRID_EASING = Easing.bezier(0.2, 0.9, 0.25, 1);

/** The system's blue in each mode (systemBlue), as glass takes a tint. */
const BLUE_LIGHT = "#007AFF";
const BLUE_DARK = "#0A84FF";

/** A round glass button; `prominent`, blue with a white icon (Done). */
const RoundButton = (props: {
  readonly icon: React.ComponentProps<typeof SystemIcon>["name"];
  readonly label: string;
  readonly onPress: () => void;
  readonly prominent?: boolean;
}): React.ReactElement => {
  const styles = useThemedStyles(makeStyles);
  const textColors = useTextColors();
  const scheme = useColorScheme() === "dark" ? "dark" : "light";
  const prominent = props.prominent === true;
  const tint = prominent ? (scheme === "dark" ? BLUE_DARK : BLUE_LIGHT) : scheme === "dark" ? FIELD_TINT_DARK : FIELD_TINT_LIGHT;
  return (
    <GlassView style={styles.round} glassEffectStyle={prominent ? "regular" : "clear"} tintColor={tint} colorScheme={scheme}>
      <Pressable style={styles.roundHit} accessibilityRole="button" accessibilityLabel={props.label} onPress={props.onPress}>
        <SystemIcon name={props.icon} size={20} weight={prominent ? "semibold" : "medium"} color={prominent ? "#FFFFFF" : textColors.label} />
      </Pressable>
    </GlassView>
  );
};

export const TabOverview = (props: {
  /** Where a repo's paths are shown from: its Files root first, then its
   * worktrees (filePaths.ts). */
  readonly rootsOf: (repo: string) => ReadonlyArray<string>;
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
  readonly hiddenTab: TabRef | undefined;
  readonly onSelect: (tab: TabRef) => void;
  readonly onClose: (tab: TabRef) => void;
  readonly onNew: () => void;
  /** Done: back into the tab showing. */
  readonly onDone: () => void;
  readonly screen: { readonly width: number; readonly height: number };
  readonly topInset: number;
  /** Where everything in the grid is (tabLayout.ts). */
  readonly layout: TabLayout;
  /** The zoom (0 a tab at full screen, 1 in the grid): the grid fades in
   * with it, around the zooming tab. */
  readonly reveal: SharedValue<number>;
  /** The page's top inset, as the previews draw it. */
  readonly pageTop: number;
  /** At its top left: back out of Files (FilesScreen's back button). */
  readonly back: React.ReactNode;
  /** At its top right: whose tabs it shows, and their worktrees
   * (RepoMenuButton). */
  readonly top: React.ReactNode;

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
  // Tabs whose file or folder isn't in the worktree: disabled until it is.
  const missing = useMissingPaths();
  const { onScroll } = props;
  const reportScroll = (event: NativeSyntheticEvent<NativeScrollEvent>): void => onScroll(event.nativeEvent.contentOffset.y);
  const { reveal } = props;
  const fade = useAnimatedStyle(() => ({ opacity: reveal.value }));
  const barAway = OVERVIEW_BAR_HEIGHT + 24 + insets.bottom;
  const barSlide = useAnimatedStyle(() => ({ bottom: insets.bottom - (1 - reveal.value) * barAway }));
  // Its top slides down in with it, and away up past the screen's top.
  const topAway = insets.top * 2 + OVERVIEW_TOP_ROOM * 2;
  const topSlide = useAnimatedStyle(() => ({ top: insets.top - (1 - reveal.value) * topAway }));

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
          {/* A repo's name over its tabs (All); a folder's group: its path
            * above its tabs. */}
          {layout.headers.map((header) => (
            <Reanimated.View
              key={header.kind === "repo" ? `repo:${header.repo}` : `folder:${header.repo}:${header.folder}`}
              style={[styles.header, { top: header.y, left: layout.side, right: layout.side, height: layout.headerHeight }]}
              entering={FadeIn.duration(GRID_MS)}
              exiting={FadeOut.duration(GRID_MS)}
              layout={LinearTransition.duration(GRID_MS).easing(GRID_EASING)}
            >
              {header.kind === "repo" ? (
                <>
                  <SystemIcon name="shippingbox" size={14} color={textColors.label} />
                  <Text style={styles.repoHeaderText} numberOfLines={1}>
                    {header.repo}
                  </Text>
                </>
              ) : (
                <>
                  <SystemIcon name="folder" size={13} color={textColors.secondaryLabel} />
                  <Text style={styles.headerText} numberOfLines={1} ellipsizeMode="head">
                    {shownPath(header.folder, props.rootsOf(header.repo), fullPaths)}
                  </Text>
                </>
              )}
            </Reanimated.View>
          ))}
          {layout.tabs.map(({ repo, index, id, entry, x, y, grouped }) => {
            const disabled = missing.has(entry.path);
            return (
            <Reanimated.View
              key={`${repo}:${id}`}
              style={[styles.cell, { left: x, top: y, width: layout.cellWidth, height: layout.cellHeight }]}
              // Tabs coming (a new one, a filter) and going (closed, filtered
              // out) fade and scale; the rest glide to their places.
              entering={ZoomIn.duration(GRID_MS).easing(GRID_EASING)}
              exiting={ZoomOut.duration(GRID_MS).easing(GRID_EASING)}
              layout={LinearTransition.duration(GRID_MS).easing(GRID_EASING)}
            >
              {/* The preview at its exact size; its outline drawn over it (so it
                * shifts nothing), the close button in its corner. */}
              <View style={[styles.preview, { width: layout.cellWidth, height: layout.previewHeight }, sameTab(props.hiddenTab, { repo, index }) && styles.hidden]}>
                {/* Not in this worktree: dimmed, and it doesn't open (it can
                  * still be closed). */}
                <Pressable
                  style={disabled && styles.disabled}
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${entry.name}`}
                  accessibilityState={{ disabled }}
                  disabled={disabled}
                  onPress={() => props.onSelect({ repo, index })}
                >
                  <TabPreview entry={entry} width={layout.cellWidth} topInset={props.pageTop} />
                </Pressable>
                <View style={styles.outline} pointerEvents="none" />
                <Pressable style={styles.close} accessibilityRole="button" accessibilityLabel={`Close ${entry.name}`} onPress={() => props.onClose({ repo, index })} hitSlop={10}>
                  <SystemIcon name="xmark" size={11} weight="bold" color={textColors.label} />
                </Pressable>
              </View>
              {/* Its type beside its name, as in the address pill; its folder
                * under it, unless its group's header says it (cut at its start:
                * its end matters most). */}
              <View style={[styles.label, disabled && styles.disabled]}>
                <SetiIcon glyph={entry.kind === "directory" ? setiFolderGlyph ?? setiDefaultGlyph : iconForFile(entry.name).glyph} size={22} />
                <View style={styles.labelText}>
                  <Text style={styles.name} numberOfLines={1}>
                    {entry.name}
                  </Text>
                  {grouped || props.rootsOf(repo).some((root) => isRootPath(entry.path, root)) ? null : (
                    <Text style={styles.path} numberOfLines={1} ellipsizeMode="head">
                      {shownPath(parentOf(entry.path), props.rootsOf(repo), fullPaths)}
                    </Text>
                  )}
                </View>
              </View>
            </Reanimated.View>
            );
          })}
        </View>
        </LayoutAnimationConfig>
      </ScrollView>
      </Reanimated.View>
      <Reanimated.View style={[styles.top, topSlide]} pointerEvents="box-none">
        {props.back}
        {props.top}
      </Reanimated.View>
      {/* Its bar slides up in as the grid opens, and away as a tab grows
        * out of it (by layout: it is glass). */}
      <Reanimated.View style={[styles.bar, barSlide]} pointerEvents="box-none">
        <RoundButton icon="plus" label="New tab" onPress={props.onNew} />
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
        {/* Done: back into the tab showing. */}
        <RoundButton icon="checkmark" label="Done" onPress={props.onDone} prominent />
      </Reanimated.View>
    </View>
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
    repoHeaderText: {
      flex: 1,
      color: text.label,
      fontSize: 15,
      fontWeight: "700",
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
    hidden: {
      opacity: 0,
    },
    disabled: {
      opacity: 0.4,
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
    // Back at the top left, the repo menu at the top right, in from the
    // sides as Files' top bar.
    top: {
      position: "absolute",
      left: 16,
      right: 16,
      height: PILL_HEIGHT,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
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
  });
