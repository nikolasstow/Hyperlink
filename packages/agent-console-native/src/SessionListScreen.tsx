/**
 * The full list of sessions for a repo's worktree (or the whole repo), reached
 * from a "See all N sessions" row on the repo screen. A plain native-header
 * list — no glass squircle here; that's the repo screen's job.
 *
 * @internal
 */
import type { Session } from "@opencode-ai/sdk";
import * as React from "react";
import { FlatList, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useHeaderHeight } from "@react-navigation/elements";
import { ScrollViewMarker } from "react-native-screens/src/components/gamma/scroll-view-marker";
import { useFocusEffect, useIsFocused } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { WORKTREE_SETUP_PREFIX } from "./agentConstants";
import { useAppContext } from "./AppContext";
import { colors } from "./colors";
import { EdgeBlurBars } from "./EdgeBlurBars";
import { displayWorktree, groupByRepo, matchSession } from "./repoGrouping";
import type { ScannedRepo } from "./repoScan";
import { readWorkspace } from "./repoScanCache";
import type { RootStackParamList } from "./RootNavigator";
import { getCachedSessions, setCachedSessions } from "./sessionCache";
import { getSetupDate, loadReads } from "./sessionReads";
import { abortSession, promptRenameSession } from "./sessionActions";
import { SessionCard } from "./SessionCard";
import { relativeTime } from "./time";
import { useSessionActivity } from "./useSessionActivity";

type Props = NativeStackScreenProps<RootStackParamList, "SessionList">;

export const SessionListScreen = (props: Props): React.ReactElement => {
  const { repo, worktree } = props.route.params;
  const { client } = useAppContext();
  const headerHeight = useHeaderHeight();
  const isFocused = useIsFocused();
  const { busy: busySessions, activityAt } = useSessionActivity(client, isFocused);

  const [sessions, setSessions] = React.useState<ReadonlyArray<Session>>([]);
  const [scanned, setScanned] = React.useState<ReadonlyArray<ScannedRepo>>([]);
  const [refreshing, setRefreshing] = React.useState(false);
  const [reads, setReads] = React.useState<ReadonlyMap<string, number>>(new Map());
  const [setupDate, setSetupDate] = React.useState<number>(() => Date.now());

  useFocusEffect(
    React.useCallback(() => {
      void Promise.all([loadReads(), getSetupDate()]).then(([nextReads, date]) => {
        setReads(nextReads);
        setSetupDate(date);
      });
    }, []),
  );

  const isUnread = (session: Session): boolean =>
    Math.max(session.time.updated, activityAt.get(session.id) ?? 0) > Math.max(reads.get(session.id) ?? 0, setupDate);

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

  const group = React.useMemo(() => groupByRepo(sessions, scanned).find((g) => g.repo === repo), [sessions, scanned, repo]);
  // `worktree === null` means the whole repo; otherwise just that worktree's.
  const listed = worktree === null ? (group?.sessions ?? []) : (group?.worktrees.get(worktree) ?? []);

  return (
    <View style={styles.root}>
    <ScrollViewMarker
      style={styles.fill}
      scrollEdgeEffects={{ top: "soft", bottom: "soft" }}
    >
      <FlatList
        data={listed}
        keyExtractor={(session) => session.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.secondaryLabel} />}
        contentContainerStyle={{ paddingTop: headerHeight + 8, paddingBottom: 40 }}
        ListEmptyComponent={<Text style={styles.empty}>No sessions.</Text>}
        renderItem={({ item }) => (
          <SessionCard
            client={client}
            sessionId={item.id}
            updatedAt={item.time.updated}
            title={item.title}
            worktree={displayWorktree(matchSession(item.directory, scanned).worktree)}
            meta={relativeTime(item.time.updated)}
            running={busySessions.has(item.id)}
            unread={isUnread(item)}
            previewEnabled={isFocused}
            onOpen={() => props.navigation.navigate("Chat", { sessionID: item.id })}
            onRename={() => promptRenameSession(client, item.id, item.title, () => void load())}
            onStop={() => abortSession(client, item.id, () => void load())}
          />
        )}
      />
    </ScrollViewMarker>
      <EdgeBlurBars variant="top" />
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  fill: {
    flex: 1,
  },
  empty: {
    color: colors.secondaryLabel,
    paddingHorizontal: 16,
  },
});
