/**
 * Files: one screen in the app's stack for all of a repo's folders and
 * files, in tabs. Where it is (its tabs, each with its own back and forward)
 * is Files' own (FileNav.ts, kept per repo), not the stack's, so leaving and
 * coming back returns to the same tab and place.
 *
 * Navigation is Safari's: back, forward, the tab's name (the tab bar) and Dubz
 * in the bottom bar (FileNavBar.tsx); the header's only control is the system
 * back button, to the repo. A tap or a swipe up on the name opens the tab
 * overview (TabOverview.tsx): the tab showing shrinks into its place in the
 * grid, and a tab tapped there grows back out of it to full screen, both on
 * the UI thread, from the grid's fixed geometry (nothing measured). A swipe
 * sideways on the name moves to the tab beside.
 *
 * Decisions: docs/handoffs/files-redesign-notes.md.
 *
 * @internal
 */
import { useHeaderHeight } from "@react-navigation/elements";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import * as React from "react";
import { StyleSheet, useWindowDimensions, View } from "react-native";
import Reanimated, { Easing, interpolate, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { warmCodeSurfaces } from "../../modules/code-surface";
import { codeSurfaceUri } from "../codeSurfaceAsset";
import { COMPOSER_PILL_HEIGHT } from "../composerBarSpec";
import type { DubzContext } from "../dubzSuggestions";
import { EdgeBlurBars } from "../EdgeBlurBars";
import { HeaderTitlePill } from "../HeaderTitlePill";
import { usePrimaryWorktree } from "../primaryWorktree";
import type { RootStackParamList } from "../RootNavigator";
import { useScreenBackground } from "../theme";
import { WorktreePicker } from "../WorktreePicker";
import { activeTab, canGoBack, canGoForward, type FileNavEntry, tabEntry } from "./FileNav";
import { FileListing } from "./FileListing";
import { FileNavBar } from "./FileNavBar";
import { FileView } from "./FileView";
import { filteredTabs, overviewGeometry, TabOverview, type TabFilter } from "./TabOverview";
import { closeFileTab, ensureFileRoot, fileBack, fileForward, newFileTab, openFileEntry, selectFileTab, useFileNav } from "./useFileNav";

type Props = NativeStackScreenProps<RootStackParamList, "Files">;

/**
 * How many code surfaces to keep warm. One is being looked at; the second is
 * what a second file opens into without waiting. Each costs Monaco's own
 * baseline, so this is deliberately small.
 */
const WARM_SURFACES = 2;
/** The zoom between a tab and its place in the overview. */
const ZOOM = { duration: 340, easing: Easing.bezier(0.2, 0.8, 0.2, 1) };
/** The previews' corner radius in the overview. */
const PREVIEW_RADIUS = 14;

const lastSegment = (path: string, fallback: string): string => path.split("/").filter(Boolean).pop() ?? fallback;

/** The overview: closed, opening, open or closing (into the tab `tab`). */
type Overview =
  | { readonly kind: "closed" }
  | { readonly kind: "opening" | "open" | "closing"; readonly tab: number; readonly initialScroll: number };

export const FilesScreen = (props: Props): React.ReactElement => {
  const { repo, dir } = props.route.params;
  const { navigation } = props;
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const screen = useWindowDimensions();
  const background = useScreenBackground("plain");
  // The root is the repo's primary worktree, following the picker.
  const primary = usePrimaryWorktree(repo, dir);
  const rootName = lastSegment(primary.dir, repo);
  const root = React.useMemo((): FileNavEntry => ({ path: primary.dir, name: rootName, kind: "directory" }), [primary.dir, rootName]);
  React.useEffect(() => ensureFileRoot(repo, root), [repo, root]);
  // This repo's tabs; at its root until the kept place is read back, or when
  // it was at another root.
  const kept = useFileNav(repo);
  const place = kept !== undefined && kept.root === root.path ? kept : undefined;
  const active = place === undefined ? undefined : activeTab(place);
  // The overview (below), closed or zooming in or out of it.
  const [overview, setOverview] = React.useState<Overview>({ kind: "closed" });
  // The tab drawn: the one showing; closing the overview, the one tapped (its
  // switch reaches the store a moment later).
  const tab = overview.kind === "closing" && place !== undefined ? (place.tabs[overview.tab] ?? active) : active;
  const current = (tab === undefined ? undefined : tabEntry(tab)) ?? root;
  const isRoot = current.path === root.path;

  // Build the code surfaces now, so the first file opens against a web view
  // that has already parsed Monaco. A build without the native module ignores
  // this.
  React.useEffect(() => {
    void codeSurfaceUri()
      .then((uri) => warmCodeSurfaces(WARM_SURFACES, uri))
      // Not fatal (a claim on an empty pool builds a surface cold), but a pool
      // that never warms is a slow first file with no visible cause.
      .catch((cause: unknown) => console.error("[code surface] warming the pool failed", cause));
  }, []);

  // The title: at the root, the worktree picker; elsewhere, what is showing.
  // Before the first frame (a layout effect), so it never arrives late.
  React.useLayoutEffect(() => {
    navigation.setOptions({
      headerTitle: () =>
        isRoot && primary.primary !== undefined ? <WorktreePicker repo={repo} fallback={dir} title={rootName} /> : <HeaderTitlePill title={current.name} />,
    });
  }, [navigation, isRoot, primary.primary, repo, dir, rootName, current.name]);

  // ── The overview, and the zoom in and out of it ──
  const [filter, setFilter] = React.useState<TabFilter>("all");
  const geometry = overviewGeometry(screen, insets.top);
  const scroll = React.useRef(0);
  // 0: the tab at full screen; 1: shrunk into its place in the grid.
  const zoom = useSharedValue(0);
  const visibleHeight = screen.height - geometry.top - insets.bottom - COMPOSER_PILL_HEIGHT;
  // The grid scrolled so a tab's row is in view.
  const scrollFor = (position: number): number => {
    const rows = place === undefined ? 1 : Math.ceil(filteredTabs(place, filter).length / 2);
    const maxScroll = Math.max(0, geometry.top + rows * geometry.rowHeight - visibleHeight);
    return Math.min(maxScroll, Math.max(0, Math.floor(position / 2) * geometry.rowHeight - (visibleHeight - geometry.rowHeight) / 2));
  };
  // Where a tab's preview is on the screen now.
  const positionOf = (index: number, among: TabFilter): number =>
    place === undefined ? 0 : Math.max(0, filteredTabs(place, among).findIndex((each) => each.index === index));

  const opened = React.useCallback(() => setOverview((now) => (now.kind === "opening" ? { ...now, kind: "open" } : now)), []);
  const openTabs = (): void => {
    if (place === undefined || overview.kind !== "closed") return;
    // Opened onto every tab, scrolled to the one showing.
    setFilter("all");
    const position = positionOf(place.active, "all");
    const initialScroll = scrollFor(position);
    scroll.current = initialScroll;
    setOverview({ kind: "opening", tab: place.active, initialScroll });
    zoom.value = withTiming(1, ZOOM, (finished) => {
      if (finished === true) runOnJS(opened)();
    });
  };
  const closed = React.useCallback(() => setOverview({ kind: "closed" }), []);
  const openTab = (index: number): void => {
    if (overview.kind !== "open") return;
    selectFileTab(repo, index);
    setOverview({ kind: "closing", tab: index, initialScroll: overview.initialScroll });
    zoom.value = withTiming(0, ZOOM, (finished) => {
      if (finished === true) runOnJS(closed)();
    });
  };
  // A new tab, or one from history: straight into it.
  const startTab = (entry: FileNavEntry): void => {
    newFileTab(repo, entry);
    zoom.value = 0;
    setOverview({ kind: "closed" });
  };

  // The tab zooming: from full screen to its preview's frame, or back.
  const zoomingTab = overview.kind === "closed" ? undefined : overview.tab;
  const target = geometry.previewAt(zoomingTab === undefined ? 0 : positionOf(zoomingTab, filter), overview.kind === "opening" ? overview.initialScroll : scroll.current);
  const scaleTo = target.width / screen.width;
  const zoomStyle = useAnimatedStyle(() => {
    const scale = interpolate(zoom.value, [0, 1], [1, scaleTo]);
    return {
      transform: [
        { translateX: interpolate(zoom.value, [0, 1], [0, target.x + target.width / 2 - screen.width / 2]) },
        { translateY: interpolate(zoom.value, [0, 1], [0, target.y + target.height / 2 - screen.height / 2]) },
        { scale },
      ],
      // Its corners as the preview's, at its size.
      borderRadius: interpolate(zoom.value, [0, 1], [0, PREVIEW_RADIUS / scaleTo]),
    };
  });

  // Dubz here is about the repo these files are in.
  const dubzContext = React.useMemo((): DubzContext => ({ surface: "repo", scope: { kind: "repo", repo } }), [repo]);
  const open = React.useCallback((entry: FileNavEntry) => openFileEntry(repo, entry), [repo]);
  const openInNewTab = React.useCallback((entry: FileNavEntry) => newFileTab(repo, entry), [repo]);
  const step = (by: number): void => {
    if (place === undefined) return;
    const next = place.active + by;
    if (next >= 0 && next < place.tabs.length) selectFileTab(repo, next);
  };

  return (
    <View style={styles.root}>
      {overview.kind === "closed" ? null : (
        <TabOverview
          place={place ?? { root: root.path, tabs: [], active: 0, history: [] }}
          filter={filter}
          onFilter={setFilter}
          initialScroll={overview.initialScroll}
          onScroll={(y) => {
            scroll.current = y;
          }}
          hiddenTab={overview.kind === "open" ? undefined : overview.tab}
          onSelect={openTab}
          onClose={(index) => closeFileTab(repo, index)}
          onNew={() => startTab(root)}
          onOpenVisit={startTab}
          screen={screen}
          topInset={insets.top}
        />
      )}
      {/* The tab showing; in the overview, shrunk into its place (gone once
        * there, until a tab is opened). */}
      {overview.kind === "open" ? null : (
        <Reanimated.View style={[styles.tab, { backgroundColor: background }, zoomStyle]} pointerEvents={overview.kind === "closed" ? "auto" : "none"}>
          {current.kind === "directory" ? (
            <FileListing
              key={`${tab?.id ?? "root"}:${current.path}`}
              dir={current.path}
              topInset={headerHeight}
              bottomInset={insets.bottom + COMPOSER_PILL_HEIGHT + 28}
              onOpen={open}
              onOpenInNewTab={openInNewTab}
            />
          ) : (
            <FileView key={`${tab?.id ?? "root"}:${current.path}`} path={current.path} name={current.name} topInset={headerHeight} />
          )}
        </Reanimated.View>
      )}
      {overview.kind === "closed" ? (
        <>
          <EdgeBlurBars variant="top" />
          <FileNavBar
            name={current.name}
            canGoBack={tab !== undefined && canGoBack(tab)}
            canGoForward={tab !== undefined && canGoForward(tab)}
            onBack={() => fileBack(repo)}
            onForward={() => fileForward(repo)}
            onOpenTabs={openTabs}
            onPreviousTab={() => step(-1)}
            onNextTab={() => step(1)}
            dubzContext={dubzContext}
          />
        </>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  tab: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    overflow: "hidden",
  },
});
