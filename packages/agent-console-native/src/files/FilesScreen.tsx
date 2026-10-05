/**
 * Files: one screen in the app's stack for all of a repo's folders and
 * files, in tabs. Where it is (its tabs, each with its own back and forward)
 * is Files' own (FileNav.ts, kept per repo), not the stack's, so leaving and
 * coming back returns to the same tab and place.
 *
 * Navigation is Safari's:
 * - the bottom bar (FileNavBar.tsx): back, forward, the tab's name (the tab
 *   bar) and Dubz; it drops away as a listing scrolls down and comes back as
 *   it scrolls up, or when a new page shows;
 * - a swipe in from the left edge goes back in the tab (out to the repo when
 *   there is nothing before), from the right edge forward; the page follows
 *   the finger (the app's own swipe-back is off here);
 * - a tap or a swipe up on the name opens the tab overview (TabOverview.tsx):
 *   the tab shrinks into its preview (cropped to the preview's 3:4 as it
 *   goes), and a preview tapped there grows back out of it to full screen; a
 *   new tab (its +, or history) grows out of its own place in the grid; one
 *   opened from a row's menu rises in from the bar. All on the UI thread, from
 *   the grid's fixed geometry (nothing measured).
 *
 * Its top (back to the repo, the title) is its own, not a native header, so
 * it leaves the moment the overview opens and returns as a tab lands, in
 * step with the zoom, and the overview's grid fades in and out around the
 * zooming tab. Decisions:
 * docs/handoffs/files-redesign-notes.md.
 *
 * @internal
 */
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import * as React from "react";
import { Pressable, StyleSheet, useColorScheme, useWindowDimensions, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Reanimated, { Easing, interpolate, runOnJS, useAnimatedStyle, useDerivedValue, useSharedValue, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { warmCodeSurfaces } from "../../modules/code-surface";
import { codeSurfaceUri } from "../codeSurfaceAsset";
import type { DubzContext } from "../dubzSuggestions";
import { EdgeBlurBars } from "../EdgeBlurBars";
import { HeaderTitlePill } from "../HeaderTitlePill";
import { usePrimaryWorktree } from "../primaryWorktree";
import type { RootStackParamList } from "../RootNavigator";
import { useScrollHide } from "../scrollHide";
import { HOME_HEADER_HEIGHT } from "../homeHeader";
import { SystemIcon } from "../SystemIcon";
import { useScreenBackground, useTextColors } from "../theme";
import { GlassView } from "expo-glass-effect";
import { WorktreePicker } from "../WorktreePicker";
import { activeTab, canGoBack, canGoForward, type FileNavEntry, tabEntry } from "./FileNav";
import { FileListing } from "./FileListing";
import { FileNavBar, NAV_BAR_HEIGHT } from "./FileNavBar";
import { FileView } from "./FileView";
import { TabOverview } from "./TabOverview";
import { type TabFilter, type TabLayout, tabLayout } from "./tabLayout";
import { PREVIEW_RADIUS } from "./tabShape";
import { closeFileTab, ensureFileRoot, fileBack, fileForward, newFileTab, openFileEntry, selectFileTab, useFileNav } from "./useFileNav";

type Props = NativeStackScreenProps<RootStackParamList, "Files">;

/**
 * How many code surfaces to keep warm. One is being looked at; the second is
 * what a second file opens into without waiting. Each costs Monaco's own
 * baseline, so this is deliberately small.
 */
const WARM_SURFACES = 2;
/** The zoom between a tab and its preview, Safari's quick ease-out. */
const ZOOM = { duration: 380, easing: Easing.bezier(0.2, 0.9, 0.25, 1) };
/** A tab opened from a row's menu, rising in. */
const RISE = { duration: 420, easing: Easing.bezier(0.2, 0.9, 0.25, 1) };
/** The page following a swipe from the edge, and settling. */
const SLIDE = { duration: 260, easing: Easing.out(Easing.cubic) };
/** Where a swipe must start (from the edge), and how far (or fast) it must go. */
const EDGE = 28;
const SWIPE_TURN = 0.33;
const SWIPE_FLING = 800;
/** Room under the overview's grid for its bar. */
const OVERVIEW_ROOM = 90;
/** Room under a listing for the bar, and how far the bar drops to hide. */
const BAR_ROOM = NAV_BAR_HEIGHT + 20;

const lastSegment = (path: string, fallback: string): string => path.split("/").filter(Boolean).pop() ?? fallback;

/** The overview: closed, or zooming open, open, or zooming closed into a tab
 * (`entry`, a new tab's, drawn at once rather than after the store has it). */
type Overview =
  | { readonly kind: "closed" }
  | { readonly kind: "opening" | "open"; readonly tab: number; readonly initialScroll: number; readonly frame: Frame }
  | { readonly kind: "closing"; readonly tab: number; readonly scroll: number; readonly frame: Frame; readonly entry?: FileNavEntry };

/** A preview's frame on the screen. */
interface Frame {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export const FilesScreen = (props: Props): React.ReactElement => {
  const { repo, dir } = props.route.params;
  const { navigation } = props;
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
  const [overview, setOverview] = React.useState<Overview>({ kind: "closed" });
  const [filter, setFilter] = React.useState<TabFilter>("all");
  // The tab drawn: the one showing; zooming into a tab, that one (its switch
  // reaches the store a moment later).
  const tab = overview.kind === "closing" && place !== undefined ? (place.tabs[overview.tab] ?? active) : active;
  const current = (overview.kind === "closing" ? overview.entry : undefined) ?? (tab === undefined ? undefined : tabEntry(tab)) ?? root;
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

  // The page's top: Files draws its own (no native header), so it goes and
  // comes in step with the overview.
  const headerHeight = insets.top + HOME_HEADER_HEIGHT;

  // The bar drops away as a listing scrolls down; a new page brings it back.
  const barHide = useScrollHide(BAR_ROOM + insets.bottom + 10);
  const { show: showBar } = barHide;
  React.useEffect(() => showBar(), [current.path, showBar]);

  // ── The overview, and the zoom in and out of it ──
  const scroll = React.useRef(0);
  // 0: the tab at full screen; 1: shrunk into its preview.
  const zoom = useSharedValue(0);
  // Where everything in the grid is (tabLayout.ts); `extra`, a tab about to
  // be added.
  const layoutFor = (among: TabFilter, extra?: FileNavEntry): TabLayout =>
    tabLayout(place ?? { root: root.path, tabs: [], active: 0, history: [] }, among, screen, insets.top, extra);
  const layout = layoutFor(filter);
  // A tab's preview on the screen, with the grid scrolled `scrolled` down.
  const frameOf = (laid: TabLayout, index: number, scrolled: number): Frame => {
    const found = laid.tabs.find((each) => each.index === index);
    return { x: found?.x ?? laid.side, y: (found?.y ?? insets.top + 12) - scrolled, width: laid.cellWidth, height: laid.previewHeight };
  };
  // The grid scrolled so a tab is in the middle of the screen, as far as it
  // goes.
  const scrollFor = (laid: TabLayout, index: number): number => {
    const found = laid.tabs.find((each) => each.index === index);
    const maxScroll = Math.max(0, laid.height + insets.bottom + OVERVIEW_ROOM - screen.height);
    return Math.min(maxScroll, Math.max(0, (found?.y ?? 0) - (screen.height - laid.cellHeight) / 2));
  };

  const opened = React.useCallback(() => setOverview((now) => (now.kind === "opening" ? { ...now, kind: "open" } : now)), []);
  const openTabs = (): void => {
    if (place === undefined || overview.kind !== "closed") return;
    // Opened onto every tab, scrolled to the one showing.
    setFilter("all");
    const laid = layoutFor("all");
    const initialScroll = scrollFor(laid, place.active);
    scroll.current = initialScroll;
    setOverview({ kind: "opening", tab: place.active, initialScroll, frame: frameOf(laid, place.active, initialScroll) });
    zoom.value = withTiming(1, ZOOM, (finished) => {
      if (finished === true) runOnJS(opened)();
    });
  };
  const closed = React.useCallback(() => setOverview({ kind: "closed" }), []);
  const zoomInto = (next: Overview): void => {
    setOverview(next);
    zoom.value = 1;
    zoom.value = withTiming(0, ZOOM, (finished) => {
      if (finished === true) runOnJS(closed)();
    });
  };
  const openTab = (index: number): void => {
    if (overview.kind !== "open") return;
    selectFileTab(repo, index);
    zoomInto({ kind: "closing", tab: index, scroll: scroll.current, frame: frameOf(layout, index, scroll.current) });
  };
  // A new tab from the overview (its +, or history): it grows out of the
  // place it takes in the grid.
  const startTab = (entry: FileNavEntry): void => {
    if (place === undefined || overview.kind !== "open") return;
    newFileTab(repo, entry);
    const index = place.tabs.length;
    zoomInto({ kind: "closing", tab: index, scroll: scroll.current, frame: frameOf(layoutFor(filter, entry), index, scroll.current), entry });
  };

  // The tab zooming: from full screen to its preview's frame (cropped to its
  // shape as it shrinks), or back.
  const target: Frame = overview.kind === "closed" ? { x: 0, y: 0, width: screen.width, height: screen.height } : overview.frame;
  const scaleTo = target.width / screen.width;
  const zoomStyle = useAnimatedStyle(() => {
    const scale = interpolate(zoom.value, [0, 1], [1, scaleTo]);
    // Its height, unscaled: the screen, cropped to the preview's shape.
    const height = interpolate(zoom.value, [0, 1], [screen.height, target.height / scaleTo]);
    // Its top-left on the screen, from the corner to the preview's.
    const x = interpolate(zoom.value, [0, 1], [0, target.x]);
    const y = interpolate(zoom.value, [0, 1], [0, target.y]);
    return {
      height,
      // Scaled about its centre, so moved to put its corner where it goes.
      transform: [{ translateX: x - screen.width / 2 + (scale * screen.width) / 2 }, { translateY: y - height / 2 + (scale * height) / 2 }, { scale }],
      borderRadius: interpolate(zoom.value, [0, 1], [0, PREVIEW_RADIUS / scaleTo]),
    };
  });

  // The page's top and bottom go with the zoom: off as the tab shrinks, back
  // as one grows (the bar, also as a listing scrolls).
  const topSlide = useAnimatedStyle(() => ({ top: insets.top - zoom.value * (insets.top + HOME_HEADER_HEIGHT + 16) }));
  const blurFade = useAnimatedStyle(() => ({ opacity: 1 - zoom.value }));
  const barDistance = BAR_ROOM + insets.bottom + 10;
  const scrolledAway = barHide.hidden;
  const barHidden = useDerivedValue(() => Math.max(scrolledAway.value, zoom.value * barDistance));

  // ── A tab opened from a row's menu: it rises in from the bar ──
  const rise = useSharedValue(1);
  const openInNewTab = React.useCallback(
    (entry: FileNavEntry) => {
      newFileTab(repo, entry);
      rise.value = 0;
      rise.value = withTiming(1, RISE);
    },
    [repo, rise],
  );

  // ── Swipes from the edges: back and forward in the tab ──
  const drag = useSharedValue(0);
  const tabCanGoBack = tab !== undefined && canGoBack(tab);
  const tabCanGoForward = tab !== undefined && canGoForward(tab);
  // Back in the tab; with nothing before, out to the repo.
  const back = React.useCallback((): void => {
    if (tabCanGoBack) fileBack(repo);
    else navigation.goBack();
  }, [tabCanGoBack, repo, navigation]);
  const forward = React.useCallback((): void => fileForward(repo), [repo]);
  const edgeSwipe = React.useMemo(() => {
    const from = { side: 0 };
    return Gesture.Pan()
      .activeOffsetX([-12, 12])
      .failOffsetY([-14, 14])
      .onBegin((e) => {
        from.side = e.x < EDGE ? 1 : e.x > screen.width - EDGE ? -1 : 0;
      })
      .onUpdate((e) => {
        // From the left edge, back (rightwards); from the right, forward.
        if (from.side === 1) drag.value = Math.max(0, e.translationX);
        else if (from.side === -1 && tabCanGoForward) drag.value = Math.min(0, e.translationX);
      })
      .onEnd((e) => {
        const side = from.side;
        const turned = side !== 0 && drag.value !== 0 && (Math.abs(drag.value) > screen.width * SWIPE_TURN || side * e.velocityX > SWIPE_FLING);
        if (!turned) {
          drag.value = withTiming(0, SLIDE);
          return;
        }
        // Off it goes; the page it went to slides in from the other side.
        drag.value = withTiming(side * screen.width, SLIDE, (finished) => {
          if (finished !== true) return;
          runOnJS(side === 1 ? back : forward)();
          drag.value = -side * screen.width * 0.3;
          drag.value = withTiming(0, SLIDE);
        });
      });
  }, [screen.width, drag, tabCanGoForward, back, forward]);

  const pageStyle = useAnimatedStyle(() => ({
    opacity: rise.value,
    transform: [{ translateX: drag.value }, { translateY: interpolate(rise.value, [0, 1], [screen.height * 0.18, 0]) }, { scale: interpolate(rise.value, [0, 1], [0.92, 1]) }],
  }));

  // Dubz here is about the repo these files are in.
  const dubzContext = React.useMemo((): DubzContext => ({ surface: "repo", scope: { kind: "repo", repo } }), [repo]);
  const open = React.useCallback((entry: FileNavEntry) => openFileEntry(repo, entry), [repo]);
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
          initialScroll={overview.kind === "closing" ? overview.scroll : overview.initialScroll}
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
          layout={layout}
          reveal={zoom}
          pageTop={headerHeight}
        />
      )}
      {/* The tab showing; over the overview, shrunk into its preview (gone
        * once there, until a tab is opened). Its page, inside, a fixed size, so
        * nothing in it is laid out again as the frame shrinks. */}
      {overview.kind === "open" ? null : (
        <Reanimated.View style={[styles.tab, { backgroundColor: background }, zoomStyle]} pointerEvents={overview.kind === "closed" ? "auto" : "none"}>
          <GestureDetector gesture={edgeSwipe}>
            <Reanimated.View style={[styles.page, { height: screen.height, backgroundColor: background }, pageStyle]}>
              {current.kind === "directory" ? (
                <FileListing
                  key={`${tab?.id ?? "root"}:${current.path}`}
                  dir={current.path}
                  topInset={headerHeight}
                  bottomInset={insets.bottom + BAR_ROOM + 20}
                  onOpen={open}
                  onOpenInNewTab={openInNewTab}
                  onScroll={barHide.onScroll}
                />
              ) : (
                <FileView key={`${tab?.id ?? "root"}:${current.path}`} path={current.path} name={current.name} topInset={headerHeight} />
              )}
            </Reanimated.View>
          </GestureDetector>
        </Reanimated.View>
      )}
      {/* The page's top and bottom, there until the overview is open: they
        * slide away as the tab shrinks into the grid and back as a tab grows
        * out of it, with the zoom (by layout: they are glass). */}
      {overview.kind === "open" ? null : (
        <>
          <Reanimated.View style={[StyleSheet.absoluteFill, blurFade]} pointerEvents="none">
            <EdgeBlurBars variant="top" />
          </Reanimated.View>
          {/* The page's top: back to the repo, and its title (the worktree
            * picker at the root, else what is showing). */}
          <Reanimated.View style={[styles.top, topSlide]} pointerEvents={overview.kind === "closed" ? "box-none" : "none"}>
            <BackButton onPress={() => navigation.goBack()} />
            <View style={styles.title} pointerEvents="box-none">
              {isRoot && primary.primary !== undefined ? <WorktreePicker repo={repo} fallback={dir} title={rootName} /> : <HeaderTitlePill title={current.name} />}
            </View>
          </Reanimated.View>
          <FileNavBar
            name={current.name}
            kind={current.kind}
            canGoBack={tabCanGoBack}
            canGoForward={tabCanGoForward}
            onBack={back}
            onForward={forward}
            onOpenTabs={openTabs}
            onPreviousTab={() => step(-1)}
            onNextTab={() => step(1)}
            dubzContext={dubzContext}
            hidden={barHidden}
          />
        </>
      )}
    </View>
  );
};

/** The page's back button, as the system's: a glass circle, a chevron. */
const BackButton = (props: { readonly onPress: () => void }): React.ReactElement => {
  const textColors = useTextColors();
  const scheme = useColorScheme() === "dark" ? "dark" : "light";
  return (
    <View style={styles.backShadow}>
      <GlassView style={styles.back} glassEffectStyle="regular" colorScheme={scheme}>
        <Pressable style={styles.backHit} accessibilityRole="button" accessibilityLabel="Back" onPress={props.onPress}>
          <SystemIcon name="chevron.backward" size={18} weight="semibold" color={textColors.label} />
        </Pressable>
      </GlassView>
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  top: {
    position: "absolute",
    left: 16,
    right: 16,
    height: HOME_HEADER_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
  },
  title: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
  },
  backShadow: {
    borderRadius: HOME_HEADER_HEIGHT / 2,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    zIndex: 1,
  },
  back: {
    width: HOME_HEADER_HEIGHT,
    height: HOME_HEADER_HEIGHT,
    borderRadius: HOME_HEADER_HEIGHT / 2,
  },
  backHit: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  tab: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    overflow: "hidden",
  },
  page: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
  },
});
