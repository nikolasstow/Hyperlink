/**
 * The screen you get when you open a repo or workspace: a collapsing glass
 * header (squircle) holding the repo/workspace info + a menu of its views,
 * over a scrolling list of that repo's chat sessions.
 *
 * The collapse is finger-tracked on the UI thread (Reanimated) — the OS
 * large-title collapse can't host custom glass content, so we drive it
 * ourselves, animating RN containers (never the SwiftUI glass internals) so the
 * real `expo-glass-effect` GlassView keeps rendering throughout. See
 * docs/handoffs/double-agent-repo-screen-and-plugin-system.md.
 *
 * A "repo" is a git checkout (menu: Files · Docs · Commits · Pull Requests); a
 * "workspace" is a non-git session folder (menu: Files · Docs only).
 *
 * @internal
 */
import type { Session } from "@opencode-ai/sdk";
import { GlassView } from "expo-glass-effect";
import * as React from "react";
import { Pressable, RefreshControl, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from "react-native";
import Animated, { cancelAnimation, Easing, Extrapolation, interpolate, runOnJS, scrollTo, useAnimatedReaction, useAnimatedRef, useAnimatedScrollHandler, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect, useIsFocused } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { WORKTREE_SETUP_PREFIX } from "./agentConstants";
import { useAppContext } from "./AppContext";
import { AGENT } from "./client";
import { colors } from "./colors";
import { Composer } from "./Composer";
import { clearForward } from "./fileNavHistory";
import { HomeTargetPickers, sessionDirectory, type SessionTarget } from "./HomeTargetPickers";
import { KeyboardDismissOverlay } from "./KeyboardDismissOverlay";
import type { ModelOption } from "./models";
import { useKeyboardHeight } from "./useKeyboardHeight";
import { composerRestingBottom, useKeyboardSlide } from "./useKeyboardSlide";
import { useTheme } from "./theme";
import type { ViewInfo } from "./extensionViewsClient";
import { ensureWorkspace, reloadWorkspace, useWorkspaceViews } from "./extensionViewsStore";
import { repoMenuFor, type RepoMenuItem } from "./repoMenu";
import { getApiAddress } from "./settings";
import { abortSession, promptRenameSession } from "./sessionActions";
import { SessionCard } from "./SessionCard";
import { useSessionActivity } from "./useSessionActivity";
import { EdgeBlurBars } from "./EdgeBlurBars";
import { displayWorktree, groupByRepo, MAIN_WORKTREE, matchSession } from "./repoGrouping";
import type { ScannedRepo } from "./repoScan";
import { readWorkspace, refreshWorkspace } from "./repoScanCache";
import type { RootStackParamList } from "./RootNavigator";
import { getCachedSessions, setCachedSessions } from "./sessionCache";
import { getSetupDate, loadReads } from "./sessionReads";
import { SystemIcon } from "./SystemIcon";
import { relativeTime } from "./time";
import { useGroupSize } from "./useGroupSize";

/** Release speed (points per millisecond) above which a release between the
 * header's detents counts as a flick and goes the way it was flicked. */
const DETENT_FLICK = 0.2;

/** Release speed below which UIKit does not coast, so a release can be
 * settled at once rather than when coasting begins. */
const DETENT_COASTING = 0.05;

/** A thrown header's flight: at most this long, however gently it was let go. */
const FLIGHT_MAX_MS = 420;

/** How much of the throw's speed is left when it lands (points per ms), and
 * the bounds on it: enough to show a rebound, never a wild one. */
const LANDING_FRACTION = 0.45;
const LANDING_MIN = 0.45;
const LANDING_MAX = 1.4;

/** A flight always launches at least this many times faster than it lands. */
const LAUNCH_OVER_LANDING = 1.8;

/** Collapsing, the header's weight: its acceleration (points per ms²), which
 * brings a full collapse down in about a third of a second, and the share of
 * its impact speed that the landing gives back as the rebound. */
const COLLAPSE_GRAVITY = 0.0055;
const COLLAPSE_RESTITUTION = 0.42;

/** The rebound after landing: a damped spring's motion (stiffness 300, mass
 * 1, damping ratio 0.45), started at the detent with the landing speed, so it
 * overshoots once, swings back a little and settles. Angular frequency and
 * decay rate per second, and the time until it is within half a percent. */
const REBOUND_STIFFNESS = 300;
const REBOUND_DAMPING_RATIO = 0.45;
const REBOUND_NATURAL = Math.sqrt(REBOUND_STIFFNESS);
const REBOUND_OMEGA = REBOUND_NATURAL * Math.sqrt(1 - REBOUND_DAMPING_RATIO ** 2);
const REBOUND_DECAY = REBOUND_DAMPING_RATIO * REBOUND_NATURAL;
const REBOUND_SETTLE_MS = Math.ceil((Math.log(200) / REBOUND_DECAY) * 1000);

/** A repo menu row: a fixed entry, an extension's view, or the retry row
 * shown when extension views could not be listed. */
type MenuEntry = RepoMenuItem & {
  readonly view?: ViewInfo;
  readonly retry?: boolean;
};

const retryEntry = (message: string): MenuEntry => ({
  label: `Extension views unavailable: ${message}`,
  icon: "exclamationmark.triangle",
  retry: true,
});

type Props = NativeStackScreenProps<RootStackParamList, "Repo">;

const BAR_CONTENT_HEIGHT = 44;
const SQUIRCLE_INSET = 12;
const BODY_TOP_GAP = 6;
const BODY_BOTTOM_PAD = 10;
const DEFAULT_BODY_HEIGHT = 250;
const GLASS_BUTTON = 44;
const BUTTON_ICON = 20;
const BAR_EDGE_INSET = 16;
/** Margins that exist ONLY when expanded — animated to 0 on collapse. */
const TOP_MARGIN = 10;
const SIDE_MARGIN = 10;

/** Glass ease-in: solid, then a fast falloff. Fractions of the collapse
 * distance, scaled to px in the component. The inner-header margins reuse this
 * exact curve so they track the glass. */
const GLASS_FADE_IN = [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1];
const GLASS_FADE_OUT = [1, 1, 1, 0.99, 0.97, 0.9, 0.6, 0.2, 0];
/** false = fade the squircle wrapper's opacity; true = slide it out. */
const SQUIRCLE_FADE_BY_TRANSLATE = false;

/** Stable empty map for the pickers' repo-sort input — unused while the repo is
 * locked (no repo menu), but the prop is required. Module-level so it doesn't
 * change identity each render. */
const EMPTY_ACTIVITY: ReadonlyMap<string, number> = new Map();

export const RepoScreen = (props: Props): React.ReactElement => {
  const { name, dir, isRepo } = props.route.params;
  const { client, backend, rootDir, address } = useAppContext();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const { colors: themeColors } = useTheme();
  const perGroup = useGroupSize();
  const isFocused = useIsFocused();
  const { busy: busySessions, activityAt } = useSessionActivity(client, isFocused);

  const [sessions, setSessions] = React.useState<ReadonlyArray<Session>>([]);
  const [scanned, setScanned] = React.useState<ReadonlyArray<ScannedRepo>>([]);
  const [refreshing, setRefreshing] = React.useState(false);
  const [reads, setReads] = React.useState<ReadonlyMap<string, number>>(new Map());
  // Sessions older than the app's setup date count as already-read. Default to
  // now so nothing flashes as unread before the real (earlier) date loads.
  const [setupDate, setSetupDate] = React.useState<number>(() => Date.now());

  // Reload read state whenever the screen refocuses (e.g. back from a chat that
  // just marked itself read), so Unread updates.
  useFocusEffect(
    React.useCallback(() => {
      void Promise.all([loadReads(), getSetupDate()]).then(([nextReads, date]) => {
        setReads(nextReads);
        setSetupDate(date);
      });
    }, []),
  );

  const load = React.useCallback(async (): Promise<void> => {
    const [list, scan] = await Promise.all([client.session.list(), readWorkspace()]);
    if (list.error === undefined && list.data !== undefined) {
      const visible = list.data.filter((s) => !s.title.startsWith(WORKTREE_SETUP_PREFIX));
      setSessions(visible);
      void setCachedSessions(visible);
    }
    if (scan !== undefined) setScanned(scan);
  }, [client]);

  React.useEffect(() => {
    void (async () => {
      const [cachedSessions, cachedScan] = await Promise.all([getCachedSessions(), readWorkspace()]);
      if (cachedSessions !== undefined) setSessions(cachedSessions);
      if (cachedScan !== undefined) setScanned(cachedScan);
      await load();
    })();
  }, [load]);

  const onRefresh = React.useCallback((): void => {
    setRefreshing(true);
    void load().finally(() => setRefreshing(false));
  }, [load]);

  // New-session composer, same bottom bar as Home — but the repo is fixed to this
  // page, so its dropdown shows as static text (see HomeTargetPickers lockedRepo).
  const [target, setTarget] = React.useState<SessionTarget | undefined>(undefined);
  const [sending, setSending] = React.useState(false);
  const [composerHeight, setComposerHeight] = React.useState(0);
  const keyboardHeight = useKeyboardHeight();
  const composerSlide = useKeyboardSlide(composerRestingBottom(insets.bottom));

  const onSend = React.useCallback(
    async (text: string, model: ModelOption | undefined): Promise<void> => {
      if (target === undefined || sending) return;
      setSending(true);
      try {
        const directory = sessionDirectory(target);
        const { data } = await client.session.create({ query: { directory } });
        if (data === undefined) throw new Error("no session");
        await client.session.promptAsync({
          path: { id: data.id },
          body: {
            agent: AGENT,
            parts: [{ type: "text", text }],
            model: model === undefined ? undefined : { providerID: model.providerID, modelID: model.modelID },
          },
        });
        props.navigation.navigate("Chat", { sessionID: data.id });
        void load();
      } finally {
        setSending(false);
      }
    },
    [target, sending, client, props.navigation, load],
  );

  // Rescan after a worktree/workspace is created from the pickers.
  const onWorkspaceChanged = React.useCallback(async (): Promise<void> => {
    setScanned(await refreshWorkspace(backend, rootDir));
  }, [backend, rootDir]);

  // This repo/workspace's own sessions, via the shared grouping logic.
  const group = React.useMemo(() => groupByRepo(sessions, scanned).find((g) => g.repo === name), [sessions, scanned, name]);
  const repoSessions = group?.sessions ?? [];
  const worktreeCount = group?.worktrees.size ?? 0;
  const menu = repoMenuFor(isRepo);

  // Views the backend's extension host offers for this folder (npm's scripts,
  // where there is a package.json). Home prefetched them, so they are normally
  // here on first render; a folder opened another way loads now. A failure
  // shows as its own row rather than the section quietly missing.
  const apiBase = getApiAddress(address);
  const extensionViews = useWorkspaceViews(dir);
  React.useEffect(() => {
    ensureWorkspace(apiBase, dir);
  }, [apiBase, dir]);
  const loadExtensionViews = (): void => reloadWorkspace(apiBase, dir);

  const menuEntries: ReadonlyArray<MenuEntry> = [
    ...menu,
    ...(extensionViews.kind === "ready"
      ? extensionViews.value.map((view): MenuEntry => ({ label: view.name, icon: "list.bullet.rectangle", view }))
      : extensionViews.kind === "failed"
        ? [retryEntry(extensionViews.message)]
        : []),
  ];

  // Unread = updated since you last opened it AND since app setup (so a fresh
  // install doesn't treat every pre-existing session as unread).
  const isUnread = (session: Session): boolean =>
    Math.max(session.time.updated, activityAt.get(session.id) ?? 0) > Math.max(reads.get(session.id) ?? 0, setupDate);
  const recent = repoSessions.slice(0, perGroup);
  const unread = repoSessions.filter(isUnread).slice(0, perGroup);
  const worktreeGroups: ReadonlyArray<readonly [string, ReadonlyArray<Session>]> = group ? [...group.worktrees.entries()] : [];
  // Group by worktree only when there's more than one; otherwise a flat list.
  const grouped = worktreeGroups.length > 1;

  // A section heading; `unreadCount` right-aligns an accent pill when > 0.
  const sectionHeader = (title: string, unreadCount = 0): React.ReactElement => (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionHeading}>{title}</Text>
      {unreadCount > 0 ? (
        <View style={[styles.unreadPill, { backgroundColor: themeColors.secondary }]}>
          <Text style={styles.unreadPillText}>{unreadCount}</Text>
        </View>
      ) : null}
    </View>
  );

  // `keyPrefix` keeps keys unique when a session shows in more than one section
  // (Unread + Recent + its worktree group).
  const sessionCard = (session: Session, showWorktree: boolean, keyPrefix: string): React.ReactElement => {
    const wt = showWorktree ? displayWorktree(matchSession(session.directory, scanned).worktree) : undefined;
    return (
      <SessionCard
        key={`${keyPrefix}-${session.id}`}
        client={client}
        sessionId={session.id}
        updatedAt={session.time.updated}
        title={session.title}
        worktree={wt}
        meta={relativeTime(session.time.updated)}
        running={busySessions.has(session.id)}
        unread={isUnread(session)}
        previewEnabled={isFocused}
        onOpen={() => props.navigation.navigate("Chat", { sessionID: session.id })}
        onRename={() => promptRenameSession(client, session.id, session.title, () => void load())}
        onStop={() => abortSession(client, session.id, () => void load())}
      />
    );
  };

  const seeAllRow = (worktree: string | null, count: number, title: string): React.ReactElement => (
    <TouchableOpacity
      key={`all-${worktree ?? "repo"}`}
      style={styles.seeAll}
      activeOpacity={0.6}
      onPress={() => props.navigation.navigate("SessionList", { repo: name, worktree, title })}
    >
      <Text style={styles.seeAllText}>See all {count} sessions</Text>
      <SystemIcon
        name="chevron.forward"
        size={13}
        color={colors.secondaryLabel}
      />
    </TouchableOpacity>
  );

  const metaParts = [
    `${repoSessions.length} session${repoSessions.length === 1 ? "" : "s"}`,
    ...(isRepo && worktreeCount > 1 ? [`${worktreeCount} worktrees`] : []),
    ...(group !== undefined ? [relativeTime(group.mostRecentUpdate)] : []),
  ];

  // --- Collapse geometry -----------------------------------------------------
  // The body's own clip animates its height, which re-fires the inner onLayout
  // with the shrinking (clipped) value; accepting those would corrupt the
  // geometry and wedge it collapsed. So a measurement is taken only when it
  // GROWS: the clip can only ever shrink it, so growth is real content arriving
  // late (the extension-view rows load after the first layout).
  const [bodyHeight, setBodyHeight] = React.useState(DEFAULT_BODY_HEIGHT);
  const bodyMeasured = React.useRef(0);
  const collapsedH = insets.top + BAR_CONTENT_HEIGHT;
  const expandedH = collapsedH + TOP_MARGIN + BODY_TOP_GAP + bodyHeight + BODY_BOTTOM_PAD;
  const collapseDistance = expandedH - collapsedH;
  const glassFadeInPx = GLASS_FADE_IN.map((f) => f * collapseDistance);

  const scrollY = useSharedValue(0);
  // The header has two detents, open (0) and closed (collapseDistance). A
  // release between them is thrown to one, the way a flicked iOS list moves:
  //   - flight: it leaves at the release's speed and loses energy to friction
  //     at a steady rate, so it is fast first and eases out (a constant
  //     deceleration, the path of anything thrown against friction);
  //   - landing: it reaches the detent still moving a little, and that last
  //     energy goes into a small damped rebound past it before it settles
  //     (opening, the content pulls past the top and settles at 0).
  // It runs on the UI thread and moves the scroll view every frame. A flick
  // goes the way it was flicked, a slow release to the nearer detent (thrown
  // with just enough speed to get there in time), and a fling that coasts to a
  // stop between them is thrown the same way. A touch catches it. Past the
  // closed detent the list scrolls freely.
  //
  // A flick is taken over at onMomentumBegin, once UIKit's coasting has
  // started (taking over at release loses to the coasting that follows it);
  // a release with no speed does not coast and is taken over at once.
  const scrollRef = useAnimatedRef<Animated.ScrollView>();
  /** The detent a throw is heading for, or -1 when none is running. */
  const settlingTo = useSharedValue(-1);
  /** Milliseconds into the running throw; a linear clock the curve reads. */
  const clock = useSharedValue(0);
  /** The running throw's shape: start, direction, speeds (pt/ms), flight time. */
  const thrownFrom = useSharedValue(0);
  const thrownDirection = useSharedValue(1);
  const thrownLaunch = useSharedValue(0);
  const thrownLanding = useSharedValue(0);
  const thrownFlightMs = useSharedValue(0);
  /** Whether the running flight falls (collapsing: accelerates under its own
   * weight) or is thrown (opening: eases out against friction). */
  const thrownFalls = useSharedValue(false);
  /** The velocity of the release that is now coasting. */
  const releaseVelocity = useSharedValue(0);

  /** Where the throw has the header `t` ms in: the friction flight, then the
   * damped rebound around the detent (a damped spring's exact motion, started
   * at the detent with the landing speed). Computed here rather than with
   * Reanimated's withSpring, which skips an animation whose start is already
   * its target: a rebound's case, so it never moved. */
  const throwPosition = (t: number): number => {
    "worklet";
    const flightMs = thrownFlightMs.value;
    const launch = thrownLaunch.value;
    const landing = thrownLanding.value;
    const direction = thrownDirection.value;
    if (t <= flightMs) {
      // Falling, it gains speed at a steady rate; thrown, it loses it.
      const along = thrownFalls.value ? launch * t + (COLLAPSE_GRAVITY * t * t) / 2 : launch * t - (((launch - landing) / flightMs) * t * t) / 2;
      return thrownFrom.value + direction * along;
    }
    const s = (t - flightMs) / 1000;
    return settlingTo.value + direction * ((landing * 1000) / REBOUND_OMEGA) * Math.exp(-REBOUND_DECAY * s) * Math.sin(REBOUND_OMEGA * s);
  };

  // React Native clamps a programmatic scroll at the top (seen on device: an
  // opening throw never went below 0), so the part of the rebound past the top
  // is drawn the way iOS draws its own top rubber band: the scroll holds at 0
  // and the content is pushed down by the overshoot, opening a gap under the
  // header that closes as it settles.
  useAnimatedReaction(
    () => (settlingTo.value >= 0 ? throwPosition(clock.value) : null),
    (y) => {
      if (y === null) return;
      scrollTo(scrollRef, 0, Math.max(y, 0), false);
    },
  );
  const overshootStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: settlingTo.value >= 0 ? Math.max(0, -throwPosition(clock.value)) : 0 }],
  }));

  const settle = (y: number, velocity: number): void => {
    "worklet";
    if (y <= 0.5 || y >= collapseDistance - 0.5) return;
    const target = velocity > DETENT_FLICK ? collapseDistance : velocity < -DETENT_FLICK ? 0 : y > collapseDistance / 2 ? collapseDistance : 0;
    const direction = target > y ? 1 : -1;
    const distance = Math.abs(target - y);
    // Speeds in points per millisecond, toward the detent.
    const thrown = Math.max(0, velocity * direction);
    const falls = target === collapseDistance;
    // Collapsing, the header falls under its own weight: it gains speed all
    // the way down and lands at what the fall built up, so the energy for the
    // bounce comes from the collapse, not the push. The impact keeps a share of
    // that speed (restitution) for the rebound. Opening, it is thrown: it
    // leaves at the push's speed and eases out against friction, landing with
    // a little left.
    const impact = Math.sqrt(thrown * thrown + 2 * COLLAPSE_GRAVITY * distance);
    const landing = falls
      ? Math.min(impact * COLLAPSE_RESTITUTION, LANDING_MAX)
      : Math.min(Math.max(thrown * LANDING_FRACTION, LANDING_MIN), LANDING_MAX);
    // Thrown too gently to arrive in time, it leaves just fast enough to; and
    // it always leaves faster than it lands, so the flight eases out.
    const launch = falls ? thrown : Math.max(thrown, (2 * distance) / FLIGHT_MAX_MS - landing, landing * LAUNCH_OVER_LANDING);
    const flightMs = falls ? (impact - thrown) / COLLAPSE_GRAVITY : (2 * distance) / (launch + landing);
    thrownFalls.value = falls;
    thrownFrom.value = y;
    thrownDirection.value = direction;
    thrownLaunch.value = launch;
    thrownLanding.value = landing;
    thrownFlightMs.value = flightMs;
    const totalMs = flightMs + REBOUND_SETTLE_MS;
    clock.value = 0;
    settlingTo.value = target;
    clock.value = withTiming(totalMs, { duration: totalMs, easing: Easing.linear }, (finished) => {
      if (finished !== true) return;
      scrollTo(scrollRef, 0, target, false);
      settlingTo.value = -1;
    });
  };
  const onScroll = useAnimatedScrollHandler(
    {
      onScroll: (event) => {
        scrollY.value = event.contentOffset.y;
      },
      onBeginDrag: () => {
        // A touch catches the throw where it is.
        cancelAnimation(clock);
        settlingTo.value = -1;
      },
      onEndDrag: (event) => {
        const velocity = event.velocity?.y ?? 0;
        releaseVelocity.value = velocity;
        if (Math.abs(velocity) < DETENT_COASTING) settle(event.contentOffset.y, 0);
      },
      onMomentumBegin: (event) => {
        if (settlingTo.value >= 0) return;
        // Stop UIKit's coasting where it stands: an animated scroll halts it
        // (seen on device), and to the current offset it does not move.
        scrollTo(scrollRef, 0, event.contentOffset.y, true);
        settle(event.contentOffset.y, releaseVelocity.value);
      },
      onMomentumEnd: (event) => {
        // The spring moves the scroll view without momentum events; one while
        // it runs is the coasting it replaced ending. Only a fling that
        // coasted to a stop between the detents on its own springs from here.
        if (settlingTo.value < 0) settle(event.contentOffset.y, 0);
      },
    },
    [collapseDistance],
  );

  const headerStyle = useAnimatedStyle(() => ({
    height: interpolate(scrollY.value, [0, collapseDistance], [expandedH, collapsedH], Extrapolation.CLAMP),
  }));

  const squircleStyle = useAnimatedStyle(() => {
    if (SQUIRCLE_FADE_BY_TRANSLATE) {
      return { transform: [{ translateY: interpolate(scrollY.value, [0, collapseDistance], [0, -collapseDistance], Extrapolation.CLAMP) }] };
    }
    return { opacity: interpolate(scrollY.value, glassFadeInPx, GLASS_FADE_OUT, Extrapolation.CLAMP) };
  });

  // Clip the body to a shrinking height (overflow:hidden) so its content is cut
  // off at the glass edge as it collapses instead of spilling out. This is a
  // no-shadow layer, so clipping it doesn't touch the squircle's drop shadow.
  const bodyStyle = useAnimatedStyle(() => ({
    height: interpolate(scrollY.value, [0, collapseDistance], [bodyHeight, 0], Extrapolation.CLAMP),
    opacity: interpolate(scrollY.value, [0, collapseDistance * 0.3], [1, 0], Extrapolation.CLAMP),
  }));

  // Inner-header margins ride the SAME curve as the glass (solid, then falloff).
  const innerHeaderStyle = useAnimatedStyle(() => {
    const expand = interpolate(scrollY.value, glassFadeInPx, GLASS_FADE_OUT, Extrapolation.CLAMP);
    return {
      transform: [{ translateY: TOP_MARGIN * expand }],
      paddingHorizontal: BAR_EDGE_INSET + SIDE_MARGIN * expand,
    };
  });

  // Pill glass exists only when collapsed. Toggled via glassEffectStyle (with a
  // native animate), never opacity — animating a GlassView's opacity stops it
  // rendering glass.
  const [collapsed, setCollapsed] = React.useState(false);
  useAnimatedReaction(
    () => scrollY.value > collapseDistance * 0.7,
    (isCollapsed, previous) => {
      if (isCollapsed !== previous) runOnJS(setCollapsed)(isCollapsed);
    },
  );

  return (
    <View style={styles.root}>
      <Animated.ScrollView
        onScroll={onScroll}
        scrollEventThrottle={16}
        ref={scrollRef}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.secondaryLabel} />}
        contentContainerStyle={{
          // Tall enough to reach the closed detent even with few sessions;
          // otherwise the header could stop half-collapsed.
          minHeight: windowHeight + collapseDistance,
          paddingTop: expandedH + 12,
          // Reserve room for the floating composer (measured) so the last session
          // clears it, plus the keyboard when it's up.
          paddingBottom: composerHeight + keyboardHeight + 24,
        }}
      >
        <Animated.View style={overshootStyle}>
        {repoSessions.length === 0 ? (
          <Text style={styles.empty}>No sessions in this {isRepo ? "repo" : "workspace"} yet.</Text>
        ) : (
          <>
            {unread.length > 0 ? (
              <>
                {sectionHeader("Unread")}
                {unread.map((session) => sessionCard(session, true, "unread"))}
              </>
            ) : null}

            {grouped ? (
              <>
                {sectionHeader("Recent")}
                {recent.map((session) => sessionCard(session, true, "recent"))}
                {worktreeGroups.map(([worktree, worktreeSessions]) => {
                  const heading = displayWorktree(worktree) ?? (worktree === MAIN_WORKTREE ? "Main" : "Sessions");
                  return (
                    <React.Fragment key={worktree}>
                      {sectionHeader(heading, worktreeSessions.filter(isUnread).length)}
                      {worktreeSessions.slice(0, perGroup).map((session) => sessionCard(session, false, worktree))}
                      {worktreeSessions.length > perGroup ? seeAllRow(worktree, worktreeSessions.length, heading) : null}
                    </React.Fragment>
                  );
                })}
              </>
            ) : (
              <>
                {sectionHeader("Sessions", repoSessions.filter(isUnread).length)}
                {repoSessions.slice(0, perGroup).map((session) => sessionCard(session, false, "flat"))}
                {repoSessions.length > perGroup ? seeAllRow(null, repoSessions.length, "Sessions") : null}
              </>
            )}
          </>
        )}
        </Animated.View>
      </Animated.ScrollView>

      {/* Top blur feather over the scrolling content, behind the glass header. */}
      <EdgeBlurBars variant="top" />

      {/* Collapsing glass header. */}
      <Animated.View
        pointerEvents="box-none"
        style={[styles.header, headerStyle]}
      >
        <Animated.View
          pointerEvents="none"
          style={[styles.squircleWrap, { top: insets.top, left: SQUIRCLE_INSET, right: SQUIRCLE_INSET }, squircleStyle]}
        >
          <GlassView
            style={styles.squircleGlass}
            glassEffectStyle="regular"
          />
        </Animated.View>

        {/* Body — repo/workspace info, then the menu. Measured so the glass box
         * hugs its contents. */}
        <Animated.View
          pointerEvents="box-none"
          style={[
            styles.body,
            { top: insets.top + BAR_CONTENT_HEIGHT + TOP_MARGIN + BODY_TOP_GAP, left: SQUIRCLE_INSET + 6, right: SQUIRCLE_INSET + 6 },
            bodyStyle,
          ]}
        >
          {/* Inner wrapper is measured (natural height) so the outer clip's
           * animated height doesn't feed back into the measurement. */}
          <View
            onLayout={(event) => {
              const measured = event.nativeEvent.layout.height;
              if (measured > bodyMeasured.current) {
                bodyMeasured.current = measured;
                setBodyHeight(measured);
              }
            }}
          >
          <View style={styles.info}>
            <Text style={styles.infoMeta}>{metaParts.join(" · ")}</Text>
          </View>

          <View style={styles.menuSeparator} />

          {menuEntries.map((item, index) => (
            <Pressable
              key={item.label}
              style={styles.menuRow}
              onPress={() => {
                if (item.label === "Files") {
                  clearForward();
                  props.navigation.navigate("FileExplorer", { repo: name, dir });
                } else if (item.view !== undefined) {
                  props.navigation.navigate("ExtensionView", { repo: name, dir, view: item.view.id, title: item.view.name });
                } else if (item.retry === true) {
                  loadExtensionViews();
                }
              }}
            >
              {index > 0 ? <View style={styles.rowSeparator} /> : null}
              <SystemIcon
                name={item.icon}
                size={20}
                color={colors.tint}
              />
              <Text style={styles.menuLabel}>{item.label}</Text>
              <SystemIcon
                name="chevron.forward"
                size={13}
                color={colors.secondaryLabel}
              />
            </Pressable>
          ))}
          </View>
        </Animated.View>

        {/* Inner-header: back · name · 3-dot. Margins present when expanded,
         * animating to the chat bar as it collapses. */}
        <Animated.View style={[styles.innerHeader, { top: insets.top, height: BAR_CONTENT_HEIGHT }, innerHeaderStyle]}>
          <Pressable
            onPress={() => props.navigation.goBack()}
            hitSlop={8}
          >
            <GlassView
              style={styles.glassButton}
              isInteractive
            >
              <SystemIcon
                name="chevron.backward"
                size={BUTTON_ICON}
                color={colors.label}
              />
            </GlassView>
          </Pressable>

          <View style={styles.namePillWrap}>
            <GlassView
              style={styles.namePillGlass}
              glassEffectStyle={{ style: collapsed ? "regular" : "none", animate: true }}
            />
            <Text
              numberOfLines={1}
              style={styles.nameText}
            >
              {name}
            </Text>
            <Text
              numberOfLines={1}
              ellipsizeMode="middle"
              style={styles.namePath}
            >
              {dir}
            </Text>
          </View>

          <Pressable
            onPress={() => {}}
            hitSlop={8}
          >
            <GlassView
              style={styles.glassButton}
              isInteractive
            >
              <SystemIcon
                name="ellipsis"
                size={BUTTON_ICON}
                color={colors.label}
              />
            </GlassView>
          </Pressable>
        </Animated.View>
      </Animated.View>

      {/* New-session composer — the Home bottom bar, repo locked to this page. */}
      <KeyboardDismissOverlay active={keyboardHeight > 0} />
      {/* Only the BOTTOM feather here — the repo header draws its own top blur
       * above, and a second top feather would sit over the header. */}
      <EdgeBlurBars bottomInset={keyboardHeight} variant="bottom" />
      <Animated.View
        style={[styles.composerFloat, composerSlide]}
        onLayout={(e) => setComposerHeight(e.nativeEvent.layout.height)}
      >
        <Composer
          onSend={onSend}
          disabled={sending || target === undefined}
          bottomInset={0}
          placeholder="Plan, ask, build…"
          agentSurface="repo"
          topSection={
            <HomeTargetPickers
              scanned={scanned}
              otherFolders={[]}
              activityByName={EMPTY_ACTIVITY}
              target={target}
              onChange={setTarget}
              onWorkspaceChanged={onWorkspaceChanged}
              lockedRepo={{ name, dir, isRepo }}
            />
          }
        />
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  composerFloat: {
    position: "absolute",
    left: 0,
    right: 0,
    // `bottom` is animated inline via composerSlide (rides the keyboard).
  },
  header: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
  },
  squircleWrap: {
    position: "absolute",
    bottom: 0,
  },
  squircleGlass: {
    flex: 1,
    borderRadius: 28,
  },
  body: {
    position: "absolute",
    paddingHorizontal: 6,
    overflow: "hidden",
  },
  info: {
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 14,
    gap: 5,
    alignItems: "center",
  },
  infoMeta: {
    color: colors.secondaryLabel,
    fontSize: 13,
    textAlign: "center",
  },
  menuRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingVertical: 13,
    paddingHorizontal: 10,
  },
  menuSeparator: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: 10,
    backgroundColor: colors.separator,
  },
  rowSeparator: {
    position: "absolute",
    top: 0,
    left: 44,
    right: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.separator,
  },
  menuLabel: {
    flex: 1,
    color: colors.label,
    fontSize: 17,
  },
  innerHeader: {
    position: "absolute",
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  glassButton: {
    width: GLASS_BUTTON,
    height: GLASS_BUTTON,
    borderRadius: GLASS_BUTTON / 2,
    alignItems: "center",
    justifyContent: "center",
  },
  namePillWrap: {
    flexShrink: 1,
    borderRadius: BAR_CONTENT_HEIGHT / 2,
    paddingHorizontal: 16,
    paddingVertical: 5,
    alignItems: "center",
    justifyContent: "center",
    gap: 1,
  },
  namePillGlass: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: BAR_CONTENT_HEIGHT / 2,
  },
  nameText: {
    color: colors.label,
    fontSize: 15,
    fontWeight: "600",
  },
  namePath: {
    maxWidth: "100%",
    color: colors.secondaryLabel,
    fontSize: 11,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginHorizontal: 16,
    marginTop: 20,
    marginBottom: 10,
  },
  sectionHeading: {
    color: colors.label,
    fontSize: 15,
    fontWeight: "700",
    letterSpacing: 0.2,
  },
  unreadPill: {
    minWidth: 22,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 11,
    backgroundColor: colors.themeSecondary,
    alignItems: "center",
    justifyContent: "center",
  },
  unreadPillText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "700",
  },
  seeAll: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    marginHorizontal: 16,
    marginTop: 2,
    marginBottom: 6,
    paddingVertical: 9,
  },
  seeAllText: {
    color: colors.secondaryLabel,
    fontSize: 15,
    fontWeight: "600",
  },
  empty: {
    color: colors.secondaryLabel,
    paddingHorizontal: 16,
  },
});
