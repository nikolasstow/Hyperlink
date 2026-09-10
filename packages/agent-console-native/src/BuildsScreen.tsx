/**
 * EAS builds — the list expo.dev shows, in the app. Reads OUR vite backend's
 * `/builds` (the `eas build:list` feed), newest first.
 *
 * Refreshes itself while anything is still moving: a build that is queued or
 * running changes without the user doing anything, so the list re-reads on an
 * interval until every row is terminal, then stops. Pull-to-refresh is always
 * available.
 *
 * @internal
 */
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import * as React from "react";
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAppContext } from "./AppContext";
import {
  BUILD_POLL_INTERVAL_MS,
  fetchBuilds,
  firstLine,
  hasActiveBuild,
  relativeTimeOf,
  type BuildRow,
} from "./builds";
import { BuildStatusPill } from "./BuildStatusPill";
import { colors } from "./colors";
import type { RootStackParamList } from "./RootNavigator";
import { SystemIcon } from "./SystemIcon";

type Props = NativeStackScreenProps<RootStackParamList, "Builds">;

/** "IOS · preview · 1.0.0", skipping whatever the row does not carry. */
const rowMeta = (row: BuildRow): string | undefined => {
  const parts = [row.platform, row.buildProfile, row.appVersion].filter(
    (part): part is string => part !== undefined && part.trim() !== "",
  );
  return parts.length === 0 ? undefined : parts.join(" · ");
};

export const BuildsScreen = (props: Props): React.ReactElement => {
  const insets = useSafeAreaInsets();
  const { backend } = useAppContext();

  const [rows, setRows] = React.useState<ReadonlyArray<BuildRow>>([]);
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [error, setError] = React.useState<string | undefined>(undefined);

  /**
   * A failed read keeps the rows already on screen and says what went wrong.
   * Clearing them would render as "you have no builds", which is a different
   * and untrue statement.
   */
  const load = React.useCallback(async (): Promise<void> => {
    const result = await fetchBuilds(backend);
    if (result.ok) {
      setRows(result.value);
      setError(undefined);
    } else {
      setError(result.message);
    }
    setLoading(false);
  }, [backend]);

  React.useEffect(() => {
    void load();
  }, [load]);

  // Only while something can still change. Once every row is terminal the
  // interval is torn down rather than left spinning against a static list.
  const active = hasActiveBuild(rows);
  React.useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => void load(), BUILD_POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [active, load]);

  const onRefresh = React.useCallback((): void => {
    setRefreshing(true);
    void load().finally(() => setRefreshing(false));
  }, [load]);

  const renderItem = ({ item, index }: { item: BuildRow; index: number }): React.ReactElement => {
    const meta = rowMeta(item);
    const subject = firstLine(item.gitCommitMessage);
    const when = relativeTimeOf(item.createdAt);
    return (
      <TouchableOpacity
        style={[styles.row, index === 0 && styles.rowFirst, index === rows.length - 1 && styles.rowLast]}
        activeOpacity={0.6}
        onPress={() => props.navigation.navigate("BuildDetail", { id: item.id })}
      >
        <View style={styles.rowText}>
          <View style={styles.rowTop}>
            <BuildStatusPill status={item.status} />
            {meta === undefined ? null : (
              <Text style={styles.meta} numberOfLines={1}>
                {meta}
              </Text>
            )}
          </View>
          <Text style={styles.rowTitle} numberOfLines={1}>
            {subject ?? "No commit message"}
          </Text>
        </View>
        <View style={styles.rowAccessory}>
          {when === undefined ? null : <Text style={styles.meta}>{when}</Text>}
          <SystemIcon name="chevron.right" size={14} color={colors.secondaryLabel} />
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => props.navigation.goBack()}
          accessibilityLabel="Back"
        >
          <SystemIcon name="chevron.left" size={20} color={colors.tint} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Builds</Text>
        <View style={styles.backButton} />
      </View>

      <FlatList
        data={rows}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.secondaryLabel} />
        }
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
        ListHeaderComponent={
          error === undefined ? null : (
            <View style={styles.errorCard}>
              <Text style={styles.errorText}>{error}</Text>
              <TouchableOpacity
                activeOpacity={0.6}
                onPress={() => {
                  setLoading(true);
                  void load();
                }}
              >
                <Text style={styles.retryText}>Try again</Text>
              </TouchableOpacity>
            </View>
          )
        }
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator style={styles.loading} size="small" color={colors.secondaryLabel} />
          ) : error === undefined ? (
            <Text style={styles.empty}>No builds yet.</Text>
          ) : null
        }
      />
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 4,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.separator,
  },
  backButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    flex: 1,
    color: colors.label,
    fontSize: 17,
    fontWeight: "600",
    textAlign: "center",
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  // One grouped card for the whole list: shared background, hairline
  // separators, rounded only at the ends.
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: colors.cardBackground,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.separator,
  },
  rowFirst: {
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
  },
  rowLast: {
    borderBottomLeftRadius: 14,
    borderBottomRightRadius: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.separator,
  },
  rowText: {
    flex: 1,
    gap: 6,
  },
  rowTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  rowTitle: {
    color: colors.label,
    fontSize: 15,
    fontWeight: "500",
  },
  rowAccessory: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  meta: {
    flexShrink: 1,
    color: colors.secondaryLabel,
    fontSize: 13,
  },
  loading: {
    marginTop: 32,
  },
  empty: {
    color: colors.secondaryLabel,
    fontSize: 13,
    marginTop: 32,
    marginHorizontal: 4,
  },
  errorCard: {
    backgroundColor: colors.cardBackground,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.separator,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 12,
    gap: 8,
  },
  errorText: {
    color: colors.destructive,
    fontSize: 13,
    lineHeight: 18,
  },
  retryText: {
    color: colors.tint,
    fontSize: 15,
    fontWeight: "500",
  },
});
