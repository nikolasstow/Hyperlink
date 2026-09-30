/**
 * Archived: the sessions put away, all of them (from Home's menu) or one
 * repo's or workspace's (from its screen's menu). Tasks join them here when
 * tasks exist (docs/handoffs/double-agent-repo-screen-and-plugin-system.md
 * §25–26): tasks and sessions listed together, a task's sessions within it.
 *
 * Nothing archived is kept on the phone: the page loads the archive and the
 * sessions from the server each time it opens (a skeleton while it does).
 * Each session can be unarchived (swipe, or its menu; a toast offers Undo) or
 * deleted; one unarchived leaves this list.
 *
 * @internal
 */
import type { Session } from "@opencode-ai/sdk";
import * as React from "react";
import Reanimated, { LinearTransition } from "react-native-reanimated";
import { RefreshControl, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useHeaderHeight } from "@react-navigation/elements";
import { useIsFocused } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { ScrollViewMarker } from "react-native-screens/src/components/gamma/scroll-view-marker";
import { useAppContext } from "./AppContext";
import { colors } from "./colors";
import { EdgeBlurBars } from "./EdgeBlurBars";
import { displayWorktree, groupByRepo, matchSession } from "./repoGrouping";
import type { ScannedRepo } from "./repoScan";
import { readWorkspace } from "./repoScanCache";
import type { RootStackParamList } from "./RootNavigator";
import { abortSession, confirmDeleteSession, promptRenameSession } from "./sessionActions";
import { fetchArchive, toggleMute, unarchiveWithUndo, useArchivedSessions, useMutedSessions } from "./sessionArchive";
import { LAYOUT_MS, SessionCard } from "./SessionCard";
import { getApiAddress } from "./settings";
import { SkeletonList } from "./Skeleton";
import { relativeTime } from "./time";
import { useSessionActivity } from "./useSessionActivity";

type Props = NativeStackScreenProps<RootStackParamList, "Archived">;

type Load =
  | { readonly kind: "loading" }
  | {
      readonly kind: "ready";
      readonly sessions: ReadonlyArray<Session>;
      readonly archivedAt: Readonly<Record<string, number>>;
      readonly scanned: ReadonlyArray<ScannedRepo>;
    }
  | { readonly kind: "failed"; readonly message: string };

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export const ArchivedScreen = (props: Props): React.ReactElement => {
  const { repo } = props.route.params;
  const { client, address } = useAppContext();
  const apiBase = getApiAddress(address);
  const headerHeight = useHeaderHeight();
  const isFocused = useIsFocused();
  const { busy } = useSessionActivity(client, isFocused);
  const [load, setLoad] = React.useState<Load>({ kind: "loading" });
  const [refreshing, setRefreshing] = React.useState(false);
  // Still archived now: one unarchived here leaves the list at once.
  const archivedSet = useArchivedSessions();
  const mutedSet = useMutedSessions();

  // Whether a list is on screen: a refresh that fails keeps it, and says so.
  const shown = React.useRef(false);

  /** The archive and the sessions, fresh from the server. */
  const fetchAll = React.useCallback(async (): Promise<void> => {
    try {
      const [archivedAt, list, scanned] = await Promise.all([fetchArchive(apiBase), client.session.list(), readWorkspace()]);
      if (list.error !== undefined || list.data === undefined) throw new Error("the server did not return its sessions");
      shown.current = true;
      setLoad({
        kind: "ready",
        sessions: list.data.filter((session) => session.id in archivedAt),
        archivedAt,
        scanned: scanned ?? [],
      });
    } catch (error: unknown) {
      if (shown.current) console.error("[archived] refreshing failed; the list on screen stays", error);
      else setLoad({ kind: "failed", message: messageOf(error) });
    }
  }, [apiBase, client]);

  React.useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  const listed = React.useMemo((): ReadonlyArray<Session> => {
    if (load.kind !== "ready") return [];
    const archived = load.sessions.filter((session) => archivedSet.has(session.id));
    const scoped = repo === undefined ? archived : (groupByRepo(archived, load.scanned).find((group) => group.repo === repo)?.sessions ?? []);
    return [...scoped].sort((a, b) => (load.archivedAt[b.id] ?? 0) - (load.archivedAt[a.id] ?? 0));
  }, [load, archivedSet, repo]);

  if (load.kind === "loading") {
    return (
      <View style={styles.root}>
        <SkeletonList top={headerHeight} rows={6} />
      </View>
    );
  }

  if (load.kind === "failed") {
    return (
      <View style={[styles.root, styles.center, { paddingTop: headerHeight + 40 }]}>
        <Text style={styles.message}>Couldn’t load the archive.</Text>
        <Text style={styles.detail}>{load.message}</Text>
        <TouchableOpacity onPress={() => void fetchAll()}>
          <Text style={styles.retry}>Try Again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {/* Ties the list to the native bar's scroll-edge effect, as the other
       * list pages do. */}
      <ScrollViewMarker style={styles.fill} scrollEdgeEffects={{ top: "soft", bottom: "soft" }}>
        <Reanimated.FlatList
          // Rows glide to their places as sessions leave (archived) or come back
          // (Undo), instead of snapping.
          itemLayoutAnimation={LinearTransition.duration(LAYOUT_MS)}
          data={listed}
          keyExtractor={(session) => session.id}
          contentContainerStyle={{ paddingTop: headerHeight + 8, paddingBottom: 40 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                void fetchAll().finally(() => setRefreshing(false));
              }}
              tintColor={colors.secondaryLabel}
            />
          }
          ListHeaderComponent={listed.length === 0 ? null : <Text style={styles.sectionLabel}>Sessions</Text>}
          ListEmptyComponent={<Text style={styles.empty}>Nothing archived{repo === undefined ? "" : ` in ${repo}`}.</Text>}
          renderItem={({ item }) => {
            const match = matchSession(item.directory, load.scanned);
            return (
              <SessionCard
                client={client}
                sessionId={item.id}
                updatedAt={item.time.updated}
                title={item.title}
                {...(repo === undefined ? { repo: match.repo } : {})}
                worktree={displayWorktree(match.worktree)}
                meta={`Archived ${relativeTime(load.archivedAt[item.id] ?? item.time.updated)}`}
                running={busy.has(item.id)}
                unread={false}
                previewEnabled={isFocused}
                archived
                onOpen={() => props.navigation.navigate("Chat", { sessionID: item.id })}
                onRename={() => promptRenameSession(client, item.id, item.title, () => void fetchAll())}
                onStop={() => abortSession(client, item.id, () => void fetchAll())}
                onDelete={() => confirmDeleteSession(client, item.id, item.title, () => void fetchAll())}
                onArchive={() => unarchiveWithUndo(apiBase, item.id)}
                muted={mutedSet.has(item.id)}
                onMute={() => toggleMute(apiBase, item.id)}
              />
            );
          }}
        />
      </ScrollViewMarker>
      <EdgeBlurBars variant="top" />
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  fill: {
    flex: 1,
  },
  center: {
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 24,
  },
  sectionLabel: {
    color: colors.secondaryLabel,
    fontSize: 13,
    textTransform: "uppercase",
    marginBottom: 8,
    marginHorizontal: 16,
  },
  empty: {
    color: colors.secondaryLabel,
    paddingHorizontal: 16,
  },
  message: {
    color: colors.secondaryLabel,
    fontSize: 15,
  },
  detail: {
    color: colors.secondaryLabel,
    fontSize: 12,
    fontFamily: "Menlo",
    textAlign: "center",
  },
  retry: {
    color: colors.tint,
    fontSize: 15,
    fontWeight: "600",
  },
});
