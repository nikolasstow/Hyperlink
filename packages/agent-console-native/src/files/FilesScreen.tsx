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
import Reanimated, { Easing, interpolate, runOnJS, type SharedValue, useAnimatedStyle, useDerivedValue, useSharedValue, withTiming } from "react-native-reanimated";
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
import { CARD_GAP, CARD_SCALE, PREVIEW_RADIUS } from "./tabShape";
import { TabPreview } from "./TabPreview";
import { closeFileTab, ensureFileRoot, fileBack, fileForward, newFileTab, openFileEntry, selectFileTab, useFileNav } from "./useFileNav";

type Props = NativeStackScreenProps<RootStackParamList, "Files">;

/**
 * How many code surfaces to keep warm. One is being looked at; the second is
 * what a second file opens into without waiting. Each costs Monaco's own
 * baseline, so this is deliberately small.
 */
const WARM_SURFACES = 2;
/** The zoom between a tab and its preview: iOS's sheet curve, long enough
 * to be seen. */
const ZOOM = { duration: 520, easing: Easing.bezier(0.32, 0.72, 0, 1) };
/** Swiping between tabs (Safari's): the page shrinks into a card this far,
 * rounded so, beside the next card past this gap; the swipe settles so. */
const CARD_RADIUS = 44;
const CARD_IN = { duration: 220, easing: Easing.out(Easing.cubic) };
const CARD_SETTLE = { duration: 300, easing: Easing.bezier(0.32, 0.72, 0, 1) };
/** How far (a fraction of a card) or fast a swipe must go to change tabs. */
const PAGE_TURN = 0.3;
const PAGE_FLING = 600;
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
  // A file to open in a new tab (from a chat): once, then the request is
  // spent.
  const openRequest = props.route.params.open;
  React.useEffect(() => {
    if (openRequest === undefined) return;
    newFileTab(repo, { path: openRequest.path, name: openRequest.name, kind: "file" });
    navigation.setParams({ open: undefined });
  }, [openRequest, repo, navigation]);
  // This repo's tabs; at its root until the kept place is read back, or when
  // it was at another root.
  const kept = useFileNav(repo);
  const place = kept !== undefined && kept.root === root.path ? kept : undefined;
  const active = place === undefined ? undefined : activeTab(place);
  const [overview, setOverview] = React.useState<Overview>({ kind: "closed" });
  const [filter, setFilter] = React.useState<TabFilter>("all");
  // A tab swiped to, drawn at once (its switch reaches the store a moment
  // later); cleared once the store has it.
  const [swipedTo, setSwipedTo] = React.useState<number | undefined>(undefined);
  React.useEffect(() => {
    if (swipedTo !== undefined && place?.active === swipedTo) setSwipedTo(undefined);
  }, [swipedTo, place?.active]);
  // The tab drawn: the one showing; zooming into a tab, or swiped to, that
  // one.
  const shownIndex = overview.kind === "closing" ? overview.tab : (swipedTo ?? place?.active ?? 0);
  const tab = place === undefined ? undefined : (place.tabs[shownIndex] ?? active);
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
  // Swiping between tabs (below): 0 to 1 as the page shrinks into a card;
  // `swipe`, how far the cards have moved, a fraction of a card (toward the
  // previous tab positive, the next negative). Declared here, before the
  // worklets that read them: a worklet captures what is declared when it is
  // made, and one declared later is undefined in it.
  const paging = useSharedValue(0);
  const swipe = useSharedValue(0);
  // How far apart the cards are.
  const cardStep = screen.width * CARD_SCALE + CARD_GAP;
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
  // Away, it ends well above the screen: its height and the status bar's
  // twice over (its glass draws past its frame).
  const topAway = insets.top * 2 + HOME_HEADER_HEIGHT * 2;
  const topSlide = useAnimatedStyle(() => ({ top: insets.top - Math.max(zoom.value, paging.value) * topAway }));
  const blurFade = useAnimatedStyle(() => ({ opacity: 1 - Math.max(zoom.value, paging.value) }));
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

  const pageStyle = useAnimatedStyle(() => {
    const card = 1 - (1 - CARD_SCALE) * paging.value;
    return {
      opacity: rise.value,
      borderRadius: (paging.value * CARD_RADIUS) / card,
      transform: [
        { translateX: drag.value + swipe.value * cardStep },
        { translateY: interpolate(rise.value, [0, 1], [screen.height * 0.18, 0]) },
        { scale: interpolate(rise.value, [0, 1], [0.92, 1]) * card },
      ],
    };
  });

  // ── Swiping between tabs on the pill, as Safari's ──
  // The page shrinks into a card (`paging`, declared with the zoom) over a
  // soft grey; the cards follow the finger one for one (`swipe`); let go past
  // a third of a card (or flung), the next one slides to the middle and grows
  // back to the page.
  const previousTab = place?.tabs[shownIndex - 1];
  const nextTab = place?.tabs[shownIndex + 1];
  const previous = previousTab === undefined ? undefined : tabEntry(previousTab);
  const next = nextTab === undefined ? undefined : tabEntry(nextTab);
  const hasPrevious = previous !== undefined;
  const hasNext = next !== undefined;
  const swipeTo = React.useCallback(
    (by: number): void => {
      const index = shownIndex + by;
      selectFileTab(repo, index);
      setSwipedTo(index);
    },
    [repo, shownIndex],
  );
  // The tab swiped to is drawn in the middle: the cards start from there and
  // the page grows back.
  React.useLayoutEffect(() => {
    if (swipedTo === undefined) return;
    swipe.value = 0;
    paging.value = withTiming(0, CARD_SETTLE);
  }, [swipedTo, swipe, paging]);
  // The overview's opener as of the latest render, for the pill's gestures
  // (built once, not every render).
  const openTabsLatest = React.useRef(openTabs);
  React.useEffect(() => {
    openTabsLatest.current = openTabs;
  });
  const pillGesture = React.useMemo(() => {
    const sideways = Gesture.Pan()
      .activeOffsetX([-10, 10])
      .failOffsetY([-12, 12])
      .onStart(() => {
        paging.value = withTiming(1, CARD_IN);
      })
      .onUpdate((e) => {
        const moved = e.translationX / cardStep;
        // Past the first or last tab it gives, resisting.
        swipe.value = (moved > 0 && !hasPrevious) || (moved < 0 && !hasNext) ? moved * 0.25 : Math.max(-1, Math.min(1, moved));
      })
      .onEnd((e) => {
        const toPrevious = hasPrevious && (swipe.value > PAGE_TURN || e.velocityX > PAGE_FLING);
        const toNext = hasNext && (swipe.value < -PAGE_TURN || e.velocityX < -PAGE_FLING);
        if (!toPrevious && !toNext) {
          swipe.value = withTiming(0, CARD_SETTLE);
          paging.value = withTiming(0, CARD_SETTLE);
          return;
        }
        swipe.value = withTiming(toPrevious ? 1 : -1, CARD_SETTLE, (finished) => {
          if (finished === true) runOnJS(swipeTo)(toPrevious ? -1 : 1);
        });
      });
    const up = Gesture.Pan()
      .activeOffsetY([-12, 12])
      .failOffsetX([-10, 10])
      .runOnJS(true)
      .onEnd((e) => {
        if (e.translationY < -40 || e.velocityY < -500) openTabsLatest.current();
      });
    const tap = Gesture.Tap()
      .runOnJS(true)
      .onEnd((_e, success) => {
        if (success) openTabsLatest.current();
      });
    return Gesture.Race(sideways, up, tap);
  }, [paging, swipe, cardStep, hasPrevious, hasNext, swipeTo]);
  const gutter = useCardGutter();

  // Dubz here is about the repo these files are in.
  const dubzContext = React.useMemo((): DubzContext => ({ surface: "repo", scope: { kind: "repo", repo } }), [repo]);
  const open = React.useCallback((entry: FileNavEntry) => openFileEntry(repo, entry), [repo]);

  return (
    <View style={styles.root}>
      {/* Always mounted, unseen until it opens (so opening it is only the
        * animation, its previews already drawn and kept up to date). */}
      {place === undefined ? null : (
        <TabOverview
          place={place}
          filter={filter}
          onFilter={setFilter}
          scrollTarget={overview.kind === "closed" ? 0 : overview.kind === "closing" ? overview.scroll : overview.initialScroll}
          interactive={overview.kind === "open"}
          onScroll={(y) => {
            scroll.current = y;
          }}
          hiddenTab={overview.kind === "open" || overview.kind === "closed" ? undefined : overview.tab}
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
      {/* The tab showing; over the overview, shrunk into its preview (unseen
        * while the overview is open, never unmounted). Its page, inside, a
        * fixed size, so nothing in it is laid out again as the frame shrinks.
        * Swiping between tabs, it is a card, the tabs beside it cards too. */}
      <Reanimated.View
        style={[styles.tab, { backgroundColor: gutter }, zoomStyle, overview.kind === "open" && styles.unseen]}
        pointerEvents={overview.kind === "closed" ? "auto" : "none"}
      >
          {place === undefined ? null : (
            <>
              <NeighbourCard entry={previous} side={-1} swipe={swipe} paging={paging} step={cardStep} topInset={headerHeight} />
              <NeighbourCard entry={next} side={1} swipe={swipe} paging={paging} step={cardStep} topInset={headerHeight} />
            </>
          )}
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
      {/* The page's top and bottom: they slide away as the tab shrinks into
        * the grid (and the top as the pages are swiped), and back as a tab
        * grows out of it, with the zoom (by layout: they are glass). Never
        * unmounted. */}
      {
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
          <View style={StyleSheet.absoluteFill} pointerEvents={overview.kind === "closed" ? "box-none" : "none"}>
            <FileNavBar
              name={current.name}
              kind={current.kind}
              previous={previous}
              next={next}
              pillGesture={pillGesture}
              swipe={swipe}
              paging={paging}
              canGoBack={tabCanGoBack}
              canGoForward={tabCanGoForward}
              onBack={back}
              onForward={forward}
              dubzContext={dubzContext}
              hidden={barHidden}
            />
          </View>
        </>
      }
    </View>
  );
};

/** The grey behind the cards while the pages are swiped. */
const useCardGutter = (): string => (useColorScheme() === "dark" ? "#1C1C1E" : "#E8E8ED");

/** A tab beside the one showing, while the pages are swiped: its page as a
 * card (drawn as a preview, at the screen's size), beside the page's card. */
const NeighbourCard = (props: {
  readonly entry: FileNavEntry | undefined;
  /** -1 the tab before (at the left), 1 the one after. */
  readonly side: -1 | 1;
  readonly swipe: SharedValue<number>;
  readonly paging: SharedValue<number>;
  readonly step: number;
  readonly topInset: number;
}): React.ReactElement | null => {
  const screen = useWindowDimensions();
  const background = useScreenBackground("plain");
  const { swipe, paging, step, side } = props;
  const style = useAnimatedStyle(() => {
    const card = 1 - (1 - CARD_SCALE) * paging.value;
    return {
      borderRadius: (paging.value * CARD_RADIUS) / card,
      transform: [{ translateX: (swipe.value + side) * step }, { scale: card }],
    };
  });
  if (props.entry === undefined) return null;
  return (
    <Reanimated.View style={[styles.card, { height: screen.height, backgroundColor: background }, style]} pointerEvents="none">
      <TabPreview entry={props.entry} width={screen.width} topInset={props.topInset} aspect={screen.height / screen.width} />
    </Reanimated.View>
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
    overflow: "hidden",
  },
  unseen: {
    opacity: 0,
  },
  card: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    overflow: "hidden",
  },
});
