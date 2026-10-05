/**
 * Home — "Recent" (most-recent sessions across every repo/worktree
 * combined) + a Repos list below (checkouts with real git identity),
 * with non-git session dirs broken out into their own "Workspaces" section.
 * Matches packages/agent-console's Home.tsx information architecture and
 * visual language (card styling, workspace row styling, section headings).
 *
 * @internal
 */
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import * as React from "react";
import { serverAddressOf } from "./opencode/serverAddress";
import { Agent } from "./opencode/schema/agent";
import { Model } from "./opencode/schema/model";
import { Provider } from "./opencode/schema/provider";
import { AbsolutePath } from "./opencode/schema/schema";
import { SessionID } from "./opencode/schema/session-id";
import { sendMessage } from "./outbox/useOutbox";
import { fetchSessions } from "./sessions/fetchSessions";
import type { SessionSummary } from "./sessions/sessionList";
import { RefreshControl, StyleSheet, Text, View } from "react-native";
import Animated, { LinearTransition } from "react-native-reanimated";
import { HOME_CONTENT_TOP_GAP, HOME_HEADER_HEIGHT } from "./homeHeader";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ScrollViewMarker } from "react-native-screens/src/components/gamma/scroll-view-marker";
import { WORKTREE_SETUP_PREFIX } from "./agentConstants";
import { useAppContext } from "./AppContext";
import { useFocusEffect, useIsFocused } from "@react-navigation/native";
import { abortSession, confirmDeleteSession, promptRenameSession } from "./sessionActions";
import { getSetupDate, loadReads } from "./sessionReads";
import { RepoCard } from "./RepoCard";
import { LAYOUT_MS, SessionCard } from "./SessionCard";
import { useSessionActivity } from "./useSessionActivity";
import { HomeSkeleton } from "./HomeSkeleton";
import { AGENT } from "./client";
import { colors } from "./colors";
import { Composer } from "./Composer";
import { COMPOSER_BAR_HEIGHT } from "./composerBarSpec";
import { EdgeBlurBars } from "./EdgeBlurBars";
import { KeyboardDismissOverlay } from "./KeyboardDismissOverlay";
import {
  HomeTargetPickers,
  sessionDirectory,
  type FolderTarget,
  type SessionTarget,
  TARGET_PICKERS_HEIGHT,
} from "./HomeTargetPickers";
import type { DubzContext } from "./dubzSuggestions";
import { prefetchTaskCounts } from "./taskCounts";
import type { ModelOption } from "./models";
import { displayWorktree, groupByRepo, matchSession, type RepoGroup } from "./repoGrouping";
import type { RootStackParamList } from "./RootNavigator";
import { prefetchWorkspaces } from "./extensionViewsStore";
import { refreshPlugins } from "./pluginsStore";
import { getApiAddress } from "./settings";
import type { ScannedRepo } from "./repoScan";
import { cachedReposNow, isStale, readWorkspace, refreshWorkspace } from "./repoScanCache";
import { updateScannedRepos } from "./primaryWorktree";
import { archiveWithUndo, loadArchivedSessions, loadMutedSessions, toggleMute, unarchived, useArchivedSessions, useMutedSessions, withoutArchived } from "./sessionArchive";
import { cachedSessionsNow, getCachedSessions, setCachedSessions } from "./sessionCache";
import { relativeTime } from "./time";
import { useGroupSize } from "./useGroupSize";
import { useKeyboardHeight } from "./useKeyboardHeight";
import { composerRestingBottom, useKeyboardSlide } from "./useKeyboardSlide";
import { type TextColors, useTextColors, useThemedStyles } from "./theme";
import { type HomeRow, LAYOUT_ROWS, sessionCardSize } from "./home/homeLayout";
import { keepHomeLayout } from "./home/useHomeLayout";
import { keptConversation } from "./conversations/useConversations";
import { lastSummary } from "./chat/model";

type Props = NativeStackScreenProps<RootStackParamList, "Home">;

/** Dubz on Home: about every repo, so its suggestions pick one. */
const HOME_DUBZ: DubzContext = {
  surface: "home",
  scope: { kind: "all" },
};

type Row =
  | { readonly kind: "heading"; readonly title: string }
  | { readonly kind: "session"; readonly session: SessionSummary; readonly repo: string; readonly worktree: string | undefined }
  | { readonly kind: "repo"; readonly group: RepoGroup };

const heading = (title: string): Row => ({ kind: "heading", title });

export const HomeScreen = (props: Props): React.ReactElement => {
  const styles = useThemedStyles(makeStyles);
  const textColors = useTextColors();
  const { client, backend, rootDir, address } = useAppContext();
  const groupSize = useGroupSize();
  // Only stream / lazily load previews while Home is on screen — the chat holds
  // its own stream when open.
  const isFocused = useIsFocused();
  const { busy: busySessions, activityAt } = useSessionActivity(client, isFocused);
  // Read state for the unread dots. Reloaded on focus (e.g. back from a chat
  // that just marked itself read); live activity from `activityAt` above then
  // flips a session unread the instant a message lands, without a refresh.
  const [reads, setReads] = React.useState<ReadonlyMap<string, number>>(new Map());
  const [setupDate, setSetupDate] = React.useState<number>(() => Date.now());
  // The kept list (read back at launch), so it draws from its first frame.
  const [sessions, setSessions] = React.useState<ReadonlyArray<SessionSummary>>(cachedSessionsNow);
  const [scanned, setScanned] = React.useState<ReadonlyArray<ScannedRepo>>(cachedReposNow);
  // Worktree pickers and pages read the scan too (primaryWorktree.ts).
  React.useEffect(() => {
    if (scanned.length > 0) updateScannedRepos(scanned);
  }, [scanned]);
  const [target, setTarget] = React.useState<SessionTarget | undefined>(undefined);
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [error, setError] = React.useState<string | undefined>(undefined);
  const [sending, setSending] = React.useState(false);

  const loadSessions = React.useCallback(async (): Promise<void> => {
    const data = await fetchSessions(address).catch((cause: unknown) => {
      console.error("[home] loading the sessions failed", cause);
      return undefined;
    });
    if (data === undefined) {
      setError("Couldn't reach the OpenCode server.");
      return;
    }
    const visible = data.filter((s) => !s.title.startsWith(WORKTREE_SETUP_PREFIX));
    setSessions(visible);
    void setCachedSessions(withoutArchived(visible));
  }, [address]);

  const loadScan = React.useCallback(
    async (force: boolean): Promise<void> => {
      const stale = force || (await isStale());
      // Fresh and readable: use it. No cache (or one from an older scan
      // version, which reads as none) needs a scan however recent the last.
      const cached = stale ? undefined : await readWorkspace();
      if (cached !== undefined) {
        setScanned(cached);
        return;
      }
      try {
        setScanned(await refreshWorkspace(backend, rootDir));
        setError(undefined);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't scan for repos.");
      }
    },
    [backend, rootDir],
  );

  const refreshWorktrees = React.useCallback(async (): Promise<void> => {
    try {
      setScanned(await refreshWorkspace(backend, rootDir));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't scan for repos.");
    }
  }, [backend, rootDir]);

  React.useEffect(() => {
    (async () => {
      const [cachedSessions, cachedScan] = await Promise.all([getCachedSessions(), readWorkspace()]);
      if (cachedSessions !== undefined) setSessions(cachedSessions);
      if (cachedScan !== undefined) setScanned(cachedScan);
      setLoading(false);
      await Promise.all([loadSessions(), loadScan(cachedScan === undefined)]);
    })();
  }, [loadSessions, loadScan, client, rootDir]);

  const onSend = async (text: string, model: ModelOption | undefined): Promise<void> => {
    if (target === undefined || sending) return;
    setSending(true);
    try {
      const sessionID = SessionID.create();
      const directory = sessionDirectory(target);
      // Into the outbox: it makes the folder (if new) and the session when the
      // server can take them, then sends; the chat opens at once.
      await sendMessage({
        server: serverAddressOf(address),
        sessionID,
        protocol: "v2",
        directory: directory === undefined ? undefined : AbsolutePath.make(directory),
        create: target.kind === "newFolder" ? { folder: { root: rootDir, name: target.name } } : {},
        text,
        files: [],
        model: model === undefined ? undefined : Model.Ref.make({ providerID: Provider.ID.make(model.providerID), id: Model.ID.make(model.modelID) }),
        agent: Agent.ID.make(AGENT),
      });
      props.navigation.navigate("Chat", { sessionID, protocol: "v2" });
      void loadSessions();
    } finally {
      setSending(false);
    }
  };

  const onRefresh = (): void => {
    setRefreshing(true);
    Promise.all([loadSessions(), loadScan(true)]).finally(() => setRefreshing(false));
  };


  // Reload read state whenever Home refocuses (e.g. back from a chat that just
  // marked itself read); live `activityAt` handles new arrivals while focused.
  useFocusEffect(
    React.useCallback(() => {
      void Promise.all([loadReads(), getSetupDate()]).then(([nextReads, date]) => {
        setReads(nextReads);
        setSetupDate(date);
      });
    }, []),
  );

  // A session is unread when its latest activity is newer than both the last
  // time it was opened and the app's setup date. Latest activity is the live
  // `activityAt` when the stream has seen something, else the REST update time.
  const isUnread = (session: SessionSummary): boolean =>
    Math.max(session.time.updated, activityAt.get(session.id) ?? 0) > Math.max(reads.get(session.id) ?? 0, setupDate);

  // Warm every repo's and worktree's extension views now, while this list is
  // being read, so a repo's menu and its views open with nothing to wait for.
  React.useEffect(() => {
    const workspaces = scanned.flatMap((repo) => repo.worktrees.map((worktree) => worktree.path));
    if (workspaces.length > 0) prefetchWorkspaces(getApiAddress(address), workspaces);
  }, [scanned, address]);

  // Every repo's task counts too, so Dubz's tasks block shows them the
  // instant it renders.
  React.useEffect(() => {
    prefetchTaskCounts(backend, scanned);
  }, [scanned, backend]);

  // The plugin manager's list too, so Settings → Plugins opens with it.
  React.useEffect(() => {
    void refreshPlugins(getApiAddress(address));
  }, [address]);

  // The archive, so archived sessions stay out of every list.
  React.useEffect(() => {
    void loadArchivedSessions(getApiAddress(address));
    void loadMutedSessions(getApiAddress(address));
  }, [address]);
  const mutedSet = useMutedSessions();
  const archivedSet = useArchivedSessions();
  const visible = unarchived(sessions, archivedSet);

  const sortedByRecent = [...visible].sort((a, b) => b.time.updated - a.time.updated);
  const recent = sortedByRecent.slice(0, groupSize);
  const groups = groupByRepo(visible, scanned);
  const knownGroups = groups.filter((g) => g.isKnownRepo);
  const otherGroups = groups.filter((g) => !g.isKnownRepo);

  // Picker "Workspaces" = session dirs that aren't known repos (same
  // classification as the Home list). Not a filesystem walk of root.
  const sessionFolders = React.useMemo(
    (): ReadonlyArray<FolderTarget> =>
      otherGroups.flatMap((group) => {
        const session = group.sessions[0];
        if (session === undefined) return [];
        const folder: FolderTarget = { kind: "folder", name: group.repo, path: session.directory };
        return [folder];
      }),
    [otherGroups],
  );

  const activityByName = React.useMemo((): ReadonlyMap<string, number> => {
    const map = new Map<string, number>();
    for (const group of groups) map.set(group.repo, group.mostRecentUpdate);
    return map;
  }, [groups]);

  const rows = React.useMemo(
    (): ReadonlyArray<Row> => [
      ...(recent.length > 0 ? [heading("Recent")] : []),
      ...recent.map((session): Row => {
        const { repo, worktree } = matchSession(session.directory, scanned);
        return { kind: "session", session, repo, worktree: displayWorktree(worktree) };
      }),
      ...(knownGroups.length > 0 ? [heading("Repos")] : []),
      ...knownGroups.map((group): Row => ({ kind: "repo", group })),
      ...(otherGroups.length > 0 ? [heading("Workspaces")] : []),
      ...otherGroups.map((group): Row => ({ kind: "repo", group })),
    ],
    [recent, scanned, knownGroups, otherGroups],
  );
  // Its first screenful kept for the launch screen, which draws it before
  // Home is up (home/homeLayout.ts).
  React.useEffect(() => {
    // Nothing to show yet: the kept layout stays as it was.
    if (rows.length === 0) return;
    const server = serverAddressOf(address);
    const layout = rows.slice(0, LAYOUT_ROWS).map((row, index): HomeRow => {
      switch (row.kind) {
        case "heading":
          return { kind: "heading", title: row.title, first: index === 0 };
        case "session":
          return {
            kind: "session",
            // As the card works its own out (SessionCard.tsx).
            size: sessionCardSize({
              title: row.session.title,
              pills: true,
              summary: lastSummary(keptConversation(server, row.session.id)?.messages ?? []) !== undefined,
            }),
          };
        case "repo":
          return { kind: "repo", latest: row.group.sessions[0]?.title !== undefined };
      }
    });
    keepHomeLayout(layout).catch((error: unknown) => console.error("[home layout] keeping it failed", error));
  }, [address, rows]);

  // The header is transparent, so content pads itself below it. A fixed
  // `insets.top + HOME_HEADER_HEIGHT` (shared with the launch screen) rather
  // than the live `useHeaderHeight()`: the live value arrives provisional then
  // corrects on the first frames, and the launch skeleton must pad IDENTICALLY
  // so "Recent" doesn't shift when Home takes over.
  const insets = useSafeAreaInsets();
  const navBarHeight = insets.top + HOME_HEADER_HEIGHT;
  const keyboardHeight = useKeyboardHeight();
  // Reanimated keyboard tracking so the floating composer rides the keyboard
  // exactly; the list padding / blur keep the plain number (behind the keyboard).
  const composerSlide = useKeyboardSlide(composerRestingBottom(insets.bottom));
  // The bar floats over the list (so its glass has content behind it), so
  // the list reserves the bar's height itself: a constant
  // (COMPOSER_BAR_HEIGHT), never a measurement.

  return (
    <View style={styles.root}>
      {/* ScrollViewMarker resolves the scroll view from its own direct
        * subtree, instead of the screen-level `scrollEdgeEffects` option,
        * which relies on RNSScrollViewFinder walking `subviews[0]` down
        * from the screen root and silently no-ops if it lands anywhere
        * else. That screen-level route produced nothing here across every
        * variation tried, so this marks the list explicitly. */}
      <ScrollViewMarker style={styles.list} scrollEdgeEffects={{ top: "soft", bottom: "soft" }}>
      <Animated.FlatList
        // Rows glide to their places as sessions leave (archived) or come back
        // (Undo), instead of snapping.
        itemLayoutAnimation={LinearTransition.duration(LAYOUT_MS)}
        style={styles.list}
        data={rows}
        keyExtractor={(row, i) => (row.kind === "heading" ? `h-${row.title}` : row.kind === "session" ? row.session.id : `r-${row.group.repo}-${i}`)}
        refreshControl={
          // `progressViewOffset` pushes the spinner below the transparent nav
          // bar — without it the spinner renders at content-top, hidden behind
          // the header, so the refresh works but you never see the loader.
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={textColors.secondaryLabel}
            progressViewOffset={navBarHeight}
          />
        }
        ListHeaderComponent={
          loading ? (
            <HomeSkeleton />
          ) : visible.length === 0 && error === undefined ? (
            <Text style={styles.hint}>No sessions yet.</Text>
          ) : error !== undefined ? (
            <Text style={styles.error}>{error}</Text>
          ) : null
        }
        renderItem={({ item, index }) => {
          if (item.kind === "heading") {
            return <Text style={[styles.heading, index === 0 && styles.headingFirst]}>{item.title}</Text>;
          }
          if (item.kind === "session") {
            return (
              <SessionCard
                client={client}
                sessionId={item.session.id}
                updatedAt={item.session.time.updated}
                title={item.session.title}
                repo={item.repo}
                worktree={item.worktree}
                meta={relativeTime(item.session.time.updated)}
                running={busySessions.has(item.session.id)}
                unread={isUnread(item.session)}
                previewEnabled={isFocused}
                onOpen={() => props.navigation.navigate("Chat", { sessionID: item.session.id })}
                onRename={() => promptRenameSession(client, item.session.id, item.session.title, () => void loadSessions())}
                onStop={() => abortSession(client, item.session.id, () => void loadSessions())}
                onDelete={() => confirmDeleteSession(client, item.session.id, item.session.title, () => void loadSessions())}
                onArchive={() => archiveWithUndo(getApiAddress(address), item.session.id)}
                muted={mutedSet.has(item.session.id)}
                onMute={() => toggleMute(getApiAddress(address), item.session.id)}
              />
            );
          }
          const sessionCount = item.group.sessions.length;
          const worktreeCount = item.group.worktrees.size;
          const mostRecentTitle = item.group.sessions[0]?.title;
          const metaParts = [
            `${sessionCount} session${sessionCount === 1 ? "" : "s"}`,
            ...(worktreeCount > 1 ? [`${worktreeCount} worktrees`] : []),
            relativeTime(item.group.mostRecentUpdate),
          ];
          const mainPath = scanned.find((r) => r.repo === item.group.repo)?.worktrees.find((w) => w.isMain)?.path;
          const repoDir = mainPath ?? item.group.sessions[0]?.directory ?? "";
          return (
            <RepoCard
              repo={item.group.repo}
              isKnownRepo={item.group.isKnownRepo}
              sessionCount={sessionCount}
              worktreeCount={worktreeCount}
              mostRecentTitle={mostRecentTitle}
              lastActive={relativeTime(item.group.mostRecentUpdate)}
              meta={metaParts.join(" · ")}
              onOpen={() => props.navigation.navigate("Repo", { name: item.group.repo, dir: repoDir, isRepo: item.group.isKnownRepo })}
              onSelect={(label) => {
                if (label === "Files") {
                  props.navigation.navigate("Files", { repo: item.group.repo, dir: repoDir });
                }
              }}
            />
          );
        }}
        contentContainerStyle={[styles.content, { paddingTop: navBarHeight + HOME_CONTENT_TOP_GAP, paddingBottom: COMPOSER_BAR_HEIGHT + keyboardHeight + 16 }]}
      />
      </ScrollViewMarker>
      <EdgeBlurBars />
      {/* One tap outside the composer collapses it (consumed) instead of hitting
       * a card behind it while the keyboard is up. */}
      <KeyboardDismissOverlay active={keyboardHeight > 0} dim />
      {/* From the screen's top down to the keyboard (or the bar's resting
       * spot), letting touches through where empty: the bar sits at its bottom,
       * and Dubz's window grows up inside it, so its grab bar stays within its
       * parents' bounds, where iOS delivers touches. */}
      <Animated.View style={[styles.composerFloat, composerSlide]} pointerEvents="box-none">
        <Composer
          onSend={onSend}
          disabled={sending || target === undefined}
          directory={target !== undefined ? sessionDirectory(target) : undefined}
          bottomInset={0}
          placeholder="Plan, ask, build…"
          dubzContext={HOME_DUBZ}
          topSection={{
            height: TARGET_PICKERS_HEIGHT,
            node: (
              <HomeTargetPickers
                scanned={scanned}
                otherFolders={sessionFolders}
                activityByName={activityByName}
                target={target}
                onChange={setTarget}
                onWorkspaceChanged={refreshWorktrees}
              />
            ),
          }}
        />
      </Animated.View>
    </View>
  );
};

const makeStyles = (text: TextColors) =>
  StyleSheet.create({
  root: {
    flex: 1,
  },
  list: {
    flex: 1,
  },
  composerFloat: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    // `bottom` is set inline from keyboardHeight — see the element itself.
  },
  content: {
    paddingBottom: 32,
  },
  hint: {
    color: text.secondaryLabel,
    paddingHorizontal: 16,
  },
  error: {
    color: colors.destructive,
    paddingHorizontal: 16,
  },
  heading: {
    color: text.secondaryLabel,
    fontSize: 15,
    fontWeight: "400",
    marginTop: 22,
    marginBottom: 10,
    marginHorizontal: 16,
  },
  headingFirst: {
    marginTop: 4,
  },
});
