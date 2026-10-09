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
import { HashMap, Option, Predicate } from "effect";
import * as React from "react";
import type { NavigationRoute } from "@react-navigation/native";
import { InteractionManager, Pressable, StyleSheet, Text, useColorScheme, useWindowDimensions, View } from "react-native";
import { cachedSessionTitle } from "../sessionCache";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Reanimated, { Easing, interpolate, runOnJS, type SharedValue, useAnimatedStyle, useDerivedValue, useSharedValue, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { warmCodeSurfaces } from "../../modules/code-surface";
import { codeSurfaceUri } from "../codeSurfaceAsset";
import type { DubzContext } from "../dubzSuggestions";
import { EdgeBlurBars } from "../EdgeBlurBars";
import { HeaderTitlePill, headerTitlePillWidth } from "../HeaderTitlePill";
import { primaryWorktreeOf, setPrimaryWorktree, usePrimaryWorktree, worktreesOf } from "../primaryWorktree";
import type { ScannedWorktree } from "../repoScan";
import { under } from "./pathForms";
import type { RootStackParamList } from "../RootNavigator";
import { useScrollHide } from "../scrollHide";
import { HOME_HEADER_HEIGHT } from "../homeHeader";
import { SystemIcon } from "../SystemIcon";
import { useScreenBackground, useTextColors } from "../theme";
import { GlassView } from "expo-glass-effect";
import { Button, Host, Menu, RNHostView } from "@expo/ui/swift-ui";
import { buttonStyle, menuIndicator, menuStyle } from "@expo/ui/swift-ui/modifiers";
import { canReload, reloadApp } from "../reload";
import { WorktreePicker, worktreeName, worktreePickerWidth } from "../WorktreePicker";
import { activeTab, canGoBack, canGoForward, type FileNavEntry, tabEntry } from "./FileNav";
import { FileListing } from "./FileListing";
import { FileNavBar, NAV_BAR_HEIGHT } from "./FileNavBar";
import { FileView } from "./FileView";
import { OVERVIEW_TOP_ROOM, TabOverview } from "./TabOverview";
import { sameTab, type ShownRepo, type TabFilter, type TabLayout, tabLayout, type TabRef } from "./tabLayout";
import { CARD_SCALE, cardStepAt, PREVIEW_RADIUS } from "./tabShape";
import { TabPreview } from "./TabPreview";
import { closeFileTab, ensureFileRoot, fileBack, fileForward, newFileTab, openFileEntry, rerootFileTab, selectFileTab, useFileNav, useFilePlaces } from "./useFileNav";
import { HistorySheet } from "./HistorySheet";
import { type RepoFilter, RepoMenuButton, repoFilterWidth } from "./RepoMenuButton";
import { useAppContext } from "../AppContext";
import { useCodeTheme } from "../useCodeTheme";
import { saveFileNow } from "./fileSave";
import { keepOnDevice, removeFromDevice, useKeptPaths } from "./fileKeep";
import { preloadFile } from "./preloadFile";
import { TAB_TOP_ACTIONS_WIDTH, TabTopActions } from "./TabTopActions";
import { useMissingPaths } from "./missingPaths";

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
/** The tab swiped to growing back to the page: even through its course, not
 * mostly in its first frames. */
/** The swiped-to tab's preview fading off its page. */
const COVER_FADE = { duration: 220, easing: Easing.out(Easing.quad) };
const CARD_GROW = { duration: 380, easing: Easing.bezier(0.25, 0.1, 0.25, 1) };
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

/** The top bar's side margin, and the least room between its pieces. */
const TOP_SIDE = 16;
const TOP_GAP = 8;
/** The narrowest a back button with a name is drawn (else just the
 * chevron). */
const BACK_MIN_NAMED = HOME_HEADER_HEIGHT + 40;

const lastSegment = (path: string, fallback: string): string => path.split("/").filter(Boolean).pop() ?? fallback;

/** The overview: closed, or zooming open, open, or zooming closed into a tab
 * (`entry`, a new tab's, drawn at once rather than after the store has it). */
type Overview =
  | { readonly kind: "closed" }
  | { readonly kind: "opening" | "open"; readonly tab: TabRef; readonly initialScroll: number; readonly frame: Frame }
  | { readonly kind: "closing"; readonly tab: TabRef; readonly scroll: number; readonly frame: Frame; readonly entry?: FileNavEntry };

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
    newFileTab(repo, { path: openRequest.path, name: openRequest.name, kind: openRequest.kind });
    navigation.setParams({ open: undefined });
  }, [openRequest, repo, navigation]);
  // This repo's tabs; at its root until the kept place is read back. At
  // another root (a worktree just switched to), moved there at once, as the
  // store is about to have them, so nothing empties meanwhile.
  const kept = useFileNav(repo);
  // Each tab holds its own worktree now, so a repo's place is used as kept —
  // not rerooted to a global primary.
  const place = kept;
  // Every repo's tabs (the overview shows one repo's, or all).
  const places = useFilePlaces();
  // A repo's paths are shown from its Files root, or the worktree holding
  // them.
  const rootsOf = React.useCallback(
    (of: string): ReadonlyArray<string> => [
      ...(of === repo ? [root.path] : Option.match(HashMap.get(places, of), { onNone: () => [], onSome: (each) => [each.root] })),
      ...worktreesOf(of).map((worktree) => worktree.path),
    ],
    [repo, root.path, places],
  );
  const active = place === undefined ? undefined : activeTab(place);
  const [overview, setOverview] = React.useState<Overview>({ kind: "closed" });
  // The overview pre-renders every tab's preview (each reads + tokenises a
  // file), which is costly on mount — so defer mounting it until after the push
  // settles, so opening a file isn't stuck behind that work. It still mounts on
  // demand the instant the overview is opened, so it's never missing when needed.
  const [overviewReady, setOverviewReady] = React.useState(false);
  React.useEffect(() => {
    const task = InteractionManager.runAfterInteractions(() => setOverviewReady(true));
    return () => task.cancel();
  }, []);
  const [filter, setFilter] = React.useState<TabFilter>("all");
  const [historyOpen, setHistoryOpen] = React.useState(false);
  // Whose tabs the overview shows: this repo's (each time it opens), or
  // every repo's, or another's.
  const [repoFilter, setRepoFilter] = React.useState<RepoFilter>({ kind: "repo", repo });
  const repoNow = React.useRef(repo);
  repoNow.current = repo;
  // The repos with tabs open: this one first, the rest by name.
  const reposWithTabs = [
    ...(place === undefined ? [] : [repo]),
    ...[...HashMap.keys(places)].filter((each) => each !== repo && (Option.getOrUndefined(HashMap.get(places, each))?.tabs.length ?? 0) > 0).sort((a, b) => a.localeCompare(b)),
  ];
  // A tab swiped to, drawn at once (its switch reaches the store a moment
  // later); cleared once the store has it.
  const [swipedTo, setSwipedTo] = React.useState<number | undefined>(undefined);
  React.useEffect(() => {
    if (swipedTo !== undefined && place?.active === swipedTo) setSwipedTo(undefined);
  }, [swipedTo, place?.active]);
  // The tab drawn: the one showing; zooming into a tab, or swiped to, that
  // one.
  const shownIndex = overview.kind === "closing" && overview.tab.repo === repo ? overview.tab.index : (swipedTo ?? place?.active ?? 0);
  const tab = place === undefined ? undefined : (place.tabs[shownIndex] ?? active);
  const current = (overview.kind === "closing" ? overview.entry : undefined) ?? (tab === undefined ? undefined : tabEntry(tab)) ?? root;
  // The worktree the shown tab is in (the one whose root most closely holds
  // its path), and switching it (reroots that tab alone).
  const currentWt = React.useMemo((): ScannedWorktree | undefined => {
    const holding = primary.worktrees.filter((worktree) => under(current.path, worktree.path) !== undefined);
    return [...holding].sort((a, b) => b.path.length - a.path.length)[0];
  }, [primary.worktrees, current.path]);
  const switchWorktree = React.useCallback(
    (path: string): void => {
      if (currentWt === undefined || place === undefined) return;
      const worktree = primary.worktrees.find((each) => each.path === path);
      rerootFileTab(repo, shownIndex, currentWt.path, { path, name: worktree !== undefined ? worktreeName(worktree) : lastSegment(path, repo), kind: "directory" });
    },
    [repo, shownIndex, currentWt, place, primary.worktrees],
  );

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
  // Its back button names the page before (the repo, mostly), as wide as it
  // can be and stay clear of the piece in the middle (whose width is worked
  // out, not measured): the page's title, or the tab view's repo filter.
  const navState = navigation.getState();
  const backLabel = backLabelOf(navState.routes[navState.index - 1]);
  // A file tab has no centre pill (its name is in the bottom bar; the space is
  // kept for buttons). A folder tab's centre is its worktree/name pill.
  const pageMiddle =
    current.kind === "file"
      ? 0
      : primary.primary !== undefined
        ? worktreePickerWidth(current.name, currentWt !== undefined ? worktreeName(currentWt) : "", screen.width)
        : headerTitlePillWidth(current.name, false, screen.width);
  const topBackMax = (screen.width - pageMiddle) / 2 - TOP_SIDE - TOP_GAP;
  // The tab view's filter is centered, search/history fixed at the right:
  // keep the filter clear of both (symmetric), and back clear of the filter.
  const filterLabel = repoFilter.kind === "all" ? "All Repos" : repoFilter.repo;
  const filterWorktree = repoFilter.kind === "repo" ? primaryWorktreeOf(repoFilter.repo) : undefined;
  const filterMax = screen.width - TOP_SIDE * 2 - (TAB_TOP_ACTIONS_WIDTH + TOP_GAP) * 2;
  const filterWidth = Math.min(repoFilterWidth(filterLabel, filterWorktree === undefined ? undefined : worktreeName(filterWorktree)), filterMax);
  const tabsBackMax = (screen.width - filterWidth) / 2 - TOP_SIDE - TOP_GAP;

  // The bar drops away as a listing scrolls down; a new page brings it back.
  const barHide = useScrollHide(BAR_ROOM + insets.bottom + 10);
  const { show: showBar } = barHide;
  React.useEffect(() => showBar(), [current.path, showBar]);

  // ── The overview, and the zoom in and out of it ──
  const scroll = React.useRef(0);
  // 0: the tab at full screen; 1: shrunk into its preview.
  const zoom = useSharedValue(0);
  // The preview's frame the tab zooms into or out of: set with the zoom's
  // start (not on the render after it, which comes late while the grid
  // redraws, so the zoom would run toward the wrong place).
  const zoomTarget = useSharedValue<Frame>({ x: 0, y: 0, width: screen.width, height: screen.height });
  // Swiping between tabs (below): 0 to 1 as the page shrinks into a card;
  // `swipe`, how far the cards have moved, a fraction of a card (toward the
  // previous tab positive, the next negative). Declared here, before the
  // worklets that read them: a worklet captures what is declared when it is
  // made, and one declared later is undefined in it.
  const paging = useSharedValue(0);
  const swipe = useSharedValue(0);
  // How far apart the cards are.
  // How far a finger moves the cards a whole card (as they are while swiped).
  const cardStep = cardStepAt(screen.width, 1);
  // Where everything in the grid is (tabLayout.ts); `extra`, a tab about to
  // be added.
  // The repos shown, as the repo filter has it: this one's place as Files has
  // it (at its root), the others' as kept.
  const shownRepos = (among: RepoFilter, extra?: FileNavEntry): ReadonlyArray<ShownRepo> => {
    const thisRepo: ShownRepo = { repo, place: place ?? { root: root.path, tabs: [], active: 0, history: [] }, extra };
    if (among.kind === "repo" && among.repo === repo) return [thisRepo];
    const others = (among.kind === "repo" ? [among.repo] : reposWithTabs.filter((each) => each !== repo)).flatMap((each): ReadonlyArray<ShownRepo> =>
      Option.match(HashMap.get(places, each), { onNone: () => [], onSome: (kept) => [{ repo: each, place: kept }] }),
    );
    return among.kind === "all" ? [thisRepo, ...others] : others;
  };
  const layoutFor = (among: TabFilter, extra?: FileNavEntry, repos: RepoFilter = repoFilter): TabLayout =>
    tabLayout(shownRepos(repos, extra), among, screen, insets.top + OVERVIEW_TOP_ROOM);
  const layout = layoutFor(filter);
  // A tab's preview on the screen, with the grid scrolled `scrolled` down.
  const frameOf = (laid: TabLayout, ref: TabRef, scrolled: number): Frame => {
    const found = laid.tabs.find((each) => sameTab(each, ref));
    return { x: found?.x ?? laid.side, y: (found?.y ?? insets.top + OVERVIEW_TOP_ROOM + 12) - scrolled, width: laid.cellWidth, height: laid.previewHeight };
  };
  // The grid scrolled so a tab is in the middle of the screen, as far as it
  // goes.
  const scrollFor = (laid: TabLayout, ref: TabRef): number => {
    const found = laid.tabs.find((each) => sameTab(each, ref));
    const maxScroll = Math.max(0, laid.height + insets.bottom + OVERVIEW_ROOM - screen.height);
    return Math.min(maxScroll, Math.max(0, (found?.y ?? 0) - (screen.height - laid.cellHeight) / 2));
  };

  const opened = React.useCallback(() => setOverview((now) => (now.kind === "opening" ? { ...now, kind: "open" } : now)), []);
  const openTabs = (): void => {
    if (place === undefined || overview.kind !== "closed") return;
    // Opened onto this repo's tabs, every kind, scrolled to the one showing.
    setFilter("all");
    const thisRepo: RepoFilter = { kind: "repo", repo };
    setRepoFilter(thisRepo);
    const laid = layoutFor("all", undefined, thisRepo);
    const showing: TabRef = { repo, index: place.active };
    const initialScroll = scrollFor(laid, showing);
    scroll.current = initialScroll;
    const frame = frameOf(laid, showing, initialScroll);
    setOverview({ kind: "opening", tab: showing, initialScroll, frame });
    zoomTarget.value = frame;
    zoom.value = withTiming(1, ZOOM, (finished) => {
      if (finished === true) runOnJS(opened)();
    });
  };
  // Closed, it is ready to open again: every tab, scrolled to the one showing
  // (below), so it opens already where it goes.
  const closed = React.useCallback(() => {
    setOverview({ kind: "closed" });
    setFilter("all");
    setRepoFilter({ kind: "repo", repo: repoNow.current });
  }, []);
  // The grid while closed: scrolled to the tab showing, as it will open.
  const closedScroll = place === undefined ? 0 : scrollFor(layoutFor("all", undefined, { kind: "repo", repo }), { repo, index: place.active });
  const zoomInto = (next: Overview): void => {
    setOverview(next);
    if (next.kind !== "closed") zoomTarget.value = next.frame;
    zoom.value = 1;
    zoom.value = withTiming(0, ZOOM, (finished) => {
      if (finished === true) runOnJS(closed)();
    });
  };
  // A tab opened from the grid; one of another repo's (All, or its filter)
  // takes Files to that repo, at that tab.
  const openTab = (ref: TabRef): void => {
    if (overview.kind !== "open") return;
    selectFileTab(ref.repo, ref.index);
    if (ref.repo !== repo) {
      const kept = Option.getOrUndefined(HashMap.get(places, ref.repo));
      navigation.setParams({ repo: ref.repo, dir: kept?.root ?? dir, open: undefined });
    }
    zoomInto({ kind: "closing", tab: ref, scroll: scroll.current, frame: frameOf(layout, ref, scroll.current) });
  };
  // A new tab from the overview (its +, or history): it grows out of the
  // place it takes in the grid.
  const startTab = (entry: FileNavEntry): void => {
    if (place === undefined || overview.kind !== "open") return;
    newFileTab(repo, entry);
    const added: TabRef = { repo, index: place.tabs.length };
    zoomInto({ kind: "closing", tab: added, scroll: scroll.current, frame: frameOf(layoutFor(filter, entry), added, scroll.current), entry });
  };

  // The tab zooming: from full screen to its preview's frame (cropped to its
  // shape as it shrinks), or back.
  const zoomStyle = useAnimatedStyle(() => {
    const target = zoomTarget.value;
    const scaleTo = target.width / screen.width;
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
        { translateX: drag.value + swipe.value * cardStepAt(screen.width, paging.value) },
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
  // The tabs beside this one, skipping any not in this worktree (disabled
  // until a worktree has them).
  const missing = useMissingPaths();
  const neighbourOf = (step: -1 | 1): number | undefined => {
    if (place === undefined) return undefined;
    for (let at = shownIndex + step; at >= 0 && at < place.tabs.length; at += step) {
      const each = place.tabs[at];
      const entry = each === undefined ? undefined : tabEntry(each);
      if (entry !== undefined && !missing.has(entry.path)) return at;
    }
    return undefined;
  };
  const previousIndex = neighbourOf(-1);
  const nextIndex = neighbourOf(1);
  const previousTab = previousIndex === undefined ? undefined : place?.tabs[previousIndex];
  const nextTab = nextIndex === undefined ? undefined : place?.tabs[nextIndex];
  const previous = previousTab === undefined ? undefined : tabEntry(previousTab);
  const next = nextTab === undefined ? undefined : tabEntry(nextTab);
  const hasPrevious = previous !== undefined;
  const hasNext = next !== undefined;
  // The tab swiped to's preview, over its page as the page is swapped in,
  // fading away once the page is drawn (so the page comes in under it rather
  // than popping in). Each swipe its own (`id`), so the store catching up
  // does not start the fade again.
  const [cover, setCover] = React.useState<{ readonly id: number; readonly entry: FileNavEntry } | undefined>(undefined);
  const coverShown = useSharedValue(0);
  const swipeTo = React.useCallback(
    (by: number): void => {
      const index = by < 0 ? previousIndex : nextIndex;
      if (index === undefined) return;
      const swiped = place?.tabs[index];
      const entry = swiped === undefined ? undefined : tabEntry(swiped);
      if (entry !== undefined) {
        coverShown.value = 1;
        setCover({ id: Date.now(), entry });
      }
      selectFileTab(repo, index);
      setSwipedTo(index);
    },
    [repo, previousIndex, nextIndex, place, coverShown],
  );
  const clearCover = React.useCallback((id: number) => setCover((now) => (now?.id === id ? undefined : now)), []);
  const coverId = cover?.id;
  React.useEffect(() => {
    if (coverId === undefined) return;
    // Two frames: the page's first drawn, then the fade.
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        coverShown.value = withTiming(0, COVER_FADE, (finished) => {
          if (finished === true) runOnJS(clearCover)(coverId);
        });
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [coverId, coverShown, clearCover]);
  const coverStyle = useAnimatedStyle(() => ({ opacity: coverShown.value }));
  // The tab swiped to, drawn as the page: in the middle, where its preview
  // card was (growing back already: the swipe started it).
  React.useLayoutEffect(() => {
    if (swipedTo === undefined) return;
    swipe.value = 0;
  }, [swipedTo, swipe]);
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
        // In the middle, it grows back at once (here, not waiting on the page
        // to be drawn): its preview card first, the page itself swapped in
        // under it, in the same place, once drawn.
        swipe.value = withTiming(toPrevious ? 1 : -1, CARD_SETTLE, (finished) => {
          if (finished !== true) return;
          paging.value = withTiming(0, CARD_GROW);
          runOnJS(swipeTo)(toPrevious ? -1 : 1);
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
      {/* Mounted unseen so opening it is only the animation (its previews
        * already drawn) — but deferred past the push (overviewReady) so it
        * doesn't render every preview while a file is trying to open; mounted at
        * once if the overview is opened before then. */}
      {place === undefined || (!overviewReady && overview.kind === "closed") ? null : (
        <TabOverview
          back={<BackButton onPress={() => navigation.goBack()} label={backLabel} maxWidth={tabsBackMax} />}
          top={
            <TabTopActions
              // Search: what it searches is not decided yet.
              onSearch={() => undefined}
              onHistory={() => setHistoryOpen(true)}
            />
          }
          center={
            <RepoMenuButton
              width={filterWidth}
              filter={repoFilter}
              repos={reposWithTabs}
              onFilter={setRepoFilter}
              onWorktree={(of, path) => {
                setPrimaryWorktree(of, path);
                ensureFileRoot(of, { path, name: lastSegment(path, of), kind: "directory" });
              }}
            />
          }
          rootsOf={rootsOf}
          filter={filter}
          onFilter={setFilter}
          scrollTarget={overview.kind === "closed" ? closedScroll : overview.kind === "closing" ? overview.scroll : overview.initialScroll}
          interactive={overview.kind === "open"}
          onScroll={(y) => {
            scroll.current = y;
          }}
          hiddenTab={overview.kind === "open" || overview.kind === "closed" ? undefined : overview.tab}
          onSelect={openTab}
          onClose={(ref) => closeFileTab(ref.repo, ref.index)}
          onNew={() => startTab(root)}
          onDone={() => openTab({ repo, index: place.active })}
          screen={screen}
          topInset={insets.top}
          layout={layout}
          reveal={zoom}
          pageTop={headerHeight}
        />
      )}
      {/* Everything opened in this repo's Files; a tap opens it in a new tab
        * (growing out of the grid). */}
      {place === undefined ? null : (
        <HistorySheet
          open={historyOpen}
          roots={rootsOf(repo)}
          visits={place.history}
          onClose={() => setHistoryOpen(false)}
          onOpen={(entry) => {
            setHistoryOpen(false);
            startTab(entry);
          }}
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
              <NeighbourCard entry={previous} side={-1} swipe={swipe} paging={paging} topInset={headerHeight} />
              <NeighbourCard entry={next} side={1} swipe={swipe} paging={paging} topInset={headerHeight} />
            </>
          )}
          <GestureDetector gesture={edgeSwipe}>
            <Reanimated.View style={[styles.page, { height: screen.height, backgroundColor: background }, pageStyle]}>
              {current.kind === "directory" ? (
                <FileListing
                  key={`${tab?.id ?? "root"}:${current.path}`}
                  repo={repo}
                  dir={current.path}
                  topInset={headerHeight}
                  bottomInset={insets.bottom + BAR_ROOM + 20}
                  onOpen={open}
                  onOpenInNewTab={openInNewTab}
                  onScroll={barHide.onScroll}
                />
              ) : (
                <FileView key={`${tab?.id ?? "root"}:${current.path}`} path={current.path} name={current.name} topInset={headerHeight} bottomInset={insets.bottom + BAR_ROOM + 20} />
              )}
              {cover === undefined ? null : (
                <Reanimated.View style={[StyleSheet.absoluteFill, coverStyle]} pointerEvents="none">
                  <TabPreview entry={cover.entry} width={screen.width} topInset={headerHeight} aspect={screen.height / screen.width} />
                </Reanimated.View>
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
            <BackButton onPress={() => navigation.goBack()} label={backLabel} maxWidth={topBackMax} />
            <View style={styles.topSpacer} pointerEvents="none" />
            <MoreMenu
              worktrees={current.kind === "file" ? primary.worktrees : []}
              selected={currentWt?.path}
              onSelect={switchWorktree}
              file={current.kind === "file" ? { path: current.path, name: current.name } : undefined}
            />
            <View style={styles.title} pointerEvents="box-none">
              {current.kind === "file" ? null : primary.primary !== undefined ? (
                <WorktreePicker repo={repo} fallback={dir} title={current.name} selected={currentWt?.path} onSelect={switchWorktree} />
              ) : (
                <HeaderTitlePill title={current.name} />
              )}
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
  readonly topInset: number;
}): React.ReactElement | null => {
  const screen = useWindowDimensions();
  const background = useScreenBackground("plain");
  const { swipe, paging, side } = props;
  const style = useAnimatedStyle(() => {
    const card = 1 - (1 - CARD_SCALE) * paging.value;
    return {
      borderRadius: (paging.value * CARD_RADIUS) / card,
      transform: [{ translateX: (swipe.value + side) * cardStepAt(screen.width, paging.value) }, { scale: card }],
    };
  });
  if (props.entry === undefined) return null;
  return (
    <Reanimated.View style={[styles.card, { height: screen.height, backgroundColor: background }, style]} pointerEvents="none">
      <TabPreview entry={props.entry} width={screen.width} topInset={props.topInset} aspect={screen.height / screen.width} />
    </Reanimated.View>
  );
};

/** The page's 3-dot menu, as every page's: a glass circle opening a native
 * menu (its label the glass, as the repo page's). */
const MoreMenu = (props: {
  /** A file tab's worktree selector (folders use the centre dropdown). */
  readonly worktrees: ReadonlyArray<ScannedWorktree>;
  readonly selected: string | undefined;
  readonly onSelect: (path: string) => void;
  /** The open file (undefined for a folder tab) — adds Save / Keep On Device. */
  readonly file: { readonly path: string; readonly name: string } | undefined;
}): React.ReactElement => {
  const textColors = useTextColors();
  const scheme = useColorScheme() === "dark" ? "dark" : "light";
  const { backend } = useAppContext();
  const theme = useCodeTheme();
  const kept = useKeptPaths();
  const file = props.file;
  const isKept = file !== undefined && kept.has(file.path);
  return (
    <Host
      style={styles.more}
      // Ignores the safe area: otherwise SwiftUI pads it as it slides under
      // the status bar, and it stays behind.
      ignoreSafeArea="all"
    >
      <Menu
        label={
          <RNHostView matchContents>
            <View style={styles.backShadow}>
              <GlassView style={styles.back} glassEffectStyle="regular" colorScheme={scheme}>
                <View style={styles.backHit}>
                  <SystemIcon name="ellipsis" size={18} weight="semibold" color={textColors.label} />
                </View>
              </GlassView>
            </View>
          </RNHostView>
        }
        modifiers={[menuStyle("button"), buttonStyle("plain"), menuIndicator("hidden")]}
      >
        {file === undefined ? null : <Button key="save" label="Save" systemImage="square.and.arrow.down" onPress={() => saveFileNow(file.path)} />}
        {file === undefined ? null : (
          <Button
            key="keep"
            label={isKept ? "Remove from Device" : "Keep On Device"}
            systemImage={isKept ? "trash" : "arrow.down.circle"}
            onPress={() => {
              if (isKept) {
                removeFromDevice(file.path);
              } else {
                keepOnDevice(file.path);
                void preloadFile(backend, file.path, file.name, theme);
              }
            }}
          />
        )}
        {props.worktrees.length > 1 ? (
          <Menu label={worktreeName(props.worktrees.find((worktree) => worktree.path === props.selected) ?? props.worktrees[0])} systemImage="arrow.triangle.branch">
            {props.worktrees.map((worktree) => (
              <Button
                key={worktree.path}
                label={worktreeName(worktree)}
                systemImage={worktree.path === props.selected ? "checkmark" : "arrow.triangle.branch"}
                onPress={() => props.onSelect(worktree.path)}
              />
            ))}
          </Menu>
        ) : null}
        {canReload ? (
          <Button
            label="Reload"
            systemImage="arrow.clockwise"
            onPress={reloadApp}
          />
        ) : null}
      </Menu>
    </Host>
  );
};

/** The page's back button, as the system's: a glass capsule, a chevron and
 * the name of the page it goes back to (cut short to stay within `maxWidth`:
 * clear of what is in the middle; just the chevron, a circle, without room
 * for a name). */
const BackButton = (props: { readonly onPress: () => void; readonly label: string | undefined; readonly maxWidth: number }): React.ReactElement => {
  const textColors = useTextColors();
  const scheme = useColorScheme() === "dark" ? "dark" : "light";
  const named = props.label !== undefined && props.maxWidth >= BACK_MIN_NAMED;
  return (
    <View style={[styles.backShadow, { maxWidth: Math.max(HOME_HEADER_HEIGHT, props.maxWidth) }]}>
      <GlassView style={named ? styles.backNamed : styles.back} glassEffectStyle="regular" colorScheme={scheme}>
        <Pressable style={named ? styles.backNamedHit : styles.backHit} accessibilityRole="button" accessibilityLabel={props.label === undefined ? "Back" : `Back to ${props.label}`} onPress={props.onPress}>
          <SystemIcon name="chevron.backward" size={18} weight="semibold" color={textColors.label} />
          {named ? (
            <Text style={[styles.backLabel, { color: textColors.label }]} numberOfLines={1}>
              {props.label}
            </Text>
          ) : null}
        </Pressable>
      </GlassView>
    </View>
  );
};

/** The name of the page before this one, for the back button. */
const backLabelOf = (route: NavigationRoute<RootStackParamList, keyof RootStackParamList> | undefined): string | undefined => {
  if (route === undefined) return undefined;
  // Its params as given (the route's type does not narrow them by name).
  const params: unknown = route.params;
  const param = (key: string): string | undefined => (Predicate.hasProperty(params, key) && Predicate.isString(params[key]) ? params[key] : undefined);
  switch (route.name) {
    case "Home":
      return "Home";
    case "Repo":
      return param("name") ?? "Repo";
    case "Chat": {
      const session = param("sessionID");
      return (session === undefined ? undefined : cachedSessionTitle(session)) ?? "Chat";
    }
    case "SessionList":
      return param("title") ?? "Sessions";
    case "Files":
      return param("repo") ?? "Files";
    default:
      return route.name;
  }
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  top: {
    position: "absolute",
    left: TOP_SIDE,
    right: TOP_SIDE,
    height: HOME_HEADER_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
  },
  title: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
  },
  topSpacer: {
    flex: 1,
  },
  more: {
    width: HOME_HEADER_HEIGHT,
    height: HOME_HEADER_HEIGHT,
    zIndex: 1,
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
  backNamed: {
    height: HOME_HEADER_HEIGHT,
    borderRadius: HOME_HEADER_HEIGHT / 2,
  },
  backNamedHit: {
    height: HOME_HEADER_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingLeft: 12,
    paddingRight: 16,
  },
  backLabel: {
    flexShrink: 1,
    fontSize: 16,
    fontWeight: "500",
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
