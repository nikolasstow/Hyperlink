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
import type { Session } from "@opencode-ai/sdk";
import { FlatList, RefreshControl, StyleSheet, Text, View } from "react-native";
import Animated from "react-native-reanimated";
import { HOME_CONTENT_TOP_GAP, HOME_HEADER_HEIGHT } from "./homeHeader";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ScrollViewMarker } from "react-native-screens/src/components/gamma/scroll-view-marker";
import { WORKTREE_SETUP_PREFIX } from "./agentConstants";
import { useAppContext } from "./AppContext";
import { useFocusEffect, useIsFocused } from "@react-navigation/native";
import { abortSession, promptRenameSession } from "./sessionActions";
import { getSetupDate, loadReads } from "./sessionReads";
import { RepoCard } from "./RepoCard";
import { SessionCard } from "./SessionCard";
import { useSessionActivity } from "./useSessionActivity";
import { HomeSkeleton } from "./HomeSkeleton";
import { AGENT } from "./client";
import { colors } from "./colors";
import { clearForward } from "./fileNavHistory";
import { Composer } from "./Composer";
import { EdgeBlurBars } from "./EdgeBlurBars";
import { KeyboardDismissOverlay } from "./KeyboardDismissOverlay";
import {
  HomeTargetPickers,
  sessionDirectory,
  type FolderTarget,
  type SessionTarget,
} from "./HomeTargetPickers";
import type { ModelOption } from "./models";
import { displayWorktree, groupByRepo, matchSession, type RepoGroup } from "./repoGrouping";
import type { RootStackParamList } from "./RootNavigator";
import { prefetchWorkspaces } from "./extensionViewsStore";
import { getApiAddress } from "./settings";
import type { ScannedRepo } from "./repoScan";
import { isStale, readWorkspace, refreshWorkspace } from "./repoScanCache";
import { getCachedSessions, setCachedSessions } from "./sessionCache";
import { relativeTime } from "./time";
import { useGroupSize } from "./useGroupSize";
import { useKeyboardHeight } from "./useKeyboardHeight";
import { composerRestingBottom, useKeyboardSlide } from "./useKeyboardSlide";

type Props = NativeStackScreenProps<RootStackParamList, "Home">;

type Row =
  | { readonly kind: "heading"; readonly title: string }
  | { readonly kind: "session"; readonly session: Session; readonly repo: string; readonly worktree: string | undefined }
  | { readonly kind: "repo"; readonly group: RepoGroup };

export const HomeScreen = (props: Props): React.ReactElement => {
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
  const [sessions, setSessions] = React.useState<ReadonlyArray<Session>>([]);
  const [scanned, setScanned] = React.useState<ReadonlyArray<ScannedRepo>>([]);
  const [target, setTarget] = React.useState<SessionTarget | undefined>(undefined);
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [error, setError] = React.useState<string | undefined>(undefined);
  const [sending, setSending] = React.useState(false);

  const loadSessions = React.useCallback(async (): Promise<void> => {
    const { data, error: fetchError } = await client.session.list();
    if (fetchError !== undefined || data === undefined) {
      setError("Couldn't reach the OpenCode server.");
      return;
    }
    const visible = data.filter((s) => !s.title.startsWith(WORKTREE_SETUP_PREFIX));
    setSessions(visible);
    void setCachedSessions(visible);
  }, [client]);

  const loadScan = React.useCallback(
    async (force: boolean): Promise<void> => {
      const stale = force || (await isStale());
      if (!stale) {
        const cached = await readWorkspace();
        if (cached !== undefined) setScanned(cached);
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
      const directory = sessionDirectory(target);
      const { data } = await client.session.create({ query: { directory } });
      if (data === undefined) throw new Error("no session");
      await client.session.promptAsync({
        path: { id: data.id },
        body: {
          agent: AGENT,
          parts: [{ type: "text", text }],
          model:
            model === undefined
              ? undefined
              : { providerID: model.providerID, modelID: model.modelID },
        },
      });
      props.navigation.navigate("Chat", { sessionID: data.id });
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
  const isUnread = (session: Session): boolean =>
    Math.max(session.time.updated, activityAt.get(session.id) ?? 0) > Math.max(reads.get(session.id) ?? 0, setupDate);

  // Warm every repo's and worktree's extension views now, while this list is
  // being read, so a repo's menu and its views open with nothing to wait for.
  React.useEffect(() => {
    const workspaces = scanned.flatMap((repo) => repo.worktrees.map((worktree) => worktree.path));
    if (workspaces.length > 0) prefetchWorkspaces(getApiAddress(address), workspaces);
  }, [scanned, address]);

  const sortedByRecent = [...sessions].sort((a, b) => b.time.updated - a.time.updated);
  const recent = sortedByRecent.slice(0, groupSize);
  const groups = groupByRepo(sessions, scanned);
  const knownGroups = groups.filter((g) => g.isKnownRepo);
  const otherGroups = groups.filter((g) => !g.isKnownRepo);

  // Picker "Workspaces" = session dirs that aren't known repos (same
  // classification as the Home list). Not a filesystem walk of root.
  const sessionFolders = React.useMemo(
    (): ReadonlyArray<FolderTarget> =>
      otherGroups.flatMap((group) => {
        const session = group.sessions[0];
        if (session === undefined) return [];
        return [{ kind: "folder" as const, name: group.repo, path: session.directory }];
      }),
    [otherGroups],
  );

  const activityByName = React.useMemo((): ReadonlyMap<string, number> => {
    const map = new Map<string, number>();
    for (const group of groups) map.set(group.repo, group.mostRecentUpdate);
    return map;
  }, [groups]);

  const rows: Array<Row> = [
    ...(recent.length > 0 ? [{ kind: "heading", title: "Recent" } as const] : []),
    ...recent.map((session) => {
      const { repo, worktree } = matchSession(session.directory, scanned);
      return { kind: "session", session, repo, worktree: displayWorktree(worktree) } as const;
    }),
    ...(knownGroups.length > 0 ? [{ kind: "heading", title: "Repos" } as const] : []),
    ...knownGroups.map((group) => ({ kind: "repo", group }) as const),
    ...(otherGroups.length > 0 ? [{ kind: "heading", title: "Workspaces" } as const] : []),
    ...otherGroups.map((group) => ({ kind: "repo", group }) as const),
  ];

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
  // Measured, not a fixed height — the composer grows with multi-line
  // input, and it floats over the list (absolute) so the glass has
  // content behind it, meaning the list has to reserve the space itself.
  // Same approach as SessionChatScreen's own composer.
  const [composerHeight, setComposerHeight] = React.useState(0);

  return (
    <View style={styles.root}>
      {/* ScrollViewMarker resolves the scroll view from its own direct
        * subtree, instead of the screen-level `scrollEdgeEffects` option,
        * which relies on RNSScrollViewFinder walking `subviews[0]` down
        * from the screen root and silently no-ops if it lands anywhere
        * else. That screen-level route produced nothing here across every
        * variation tried, so this marks the list explicitly. */}
      <ScrollViewMarker style={styles.list} scrollEdgeEffects={{ top: "soft", bottom: "soft" }}>
      <FlatList
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
            tintColor={colors.secondaryLabel}
            progressViewOffset={navBarHeight}
          />
        }
        ListHeaderComponent={
          loading ? (
            <HomeSkeleton />
          ) : sessions.length === 0 && error === undefined ? (
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
                  clearForward();
                  props.navigation.navigate("FileExplorer", { repo: item.group.repo, dir: repoDir });
                }
              }}
            />
          );
        }}
        contentContainerStyle={[styles.content, { paddingTop: navBarHeight + HOME_CONTENT_TOP_GAP, paddingBottom: composerHeight + keyboardHeight + 16 }]}
      />
      </ScrollViewMarker>
      <EdgeBlurBars bottomInset={keyboardHeight} />
      {/* One tap outside the composer collapses it (consumed) instead of hitting
       * a card behind it while the keyboard is up. */}
      <KeyboardDismissOverlay active={keyboardHeight > 0} />
      <Animated.View style={[styles.composerFloat, composerSlide]} onLayout={(e) => setComposerHeight(e.nativeEvent.layout.height)}>
        <Composer
          onSend={onSend}
          disabled={sending || target === undefined}
          bottomInset={0}
          placeholder="Plan, ask, build…"
          agentSurface="home"
          topSection={
            <HomeTargetPickers
              scanned={scanned}
              otherFolders={sessionFolders}
              activityByName={activityByName}
              target={target}
              onChange={setTarget}
              onWorkspaceChanged={refreshWorktrees}
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
  list: {
    flex: 1,
  },
  composerFloat: {
    position: "absolute",
    left: 0,
    right: 0,
    // `bottom` is set inline from keyboardHeight — see the element itself.
  },
  content: {
    paddingBottom: 32,
  },
  hint: {
    color: colors.secondaryLabel,
    paddingHorizontal: 16,
  },
  error: {
    color: colors.destructive,
    paddingHorizontal: 16,
  },
  heading: {
    color: colors.secondaryLabel,
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
