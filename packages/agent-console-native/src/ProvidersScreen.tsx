/**
 * Model providers — which ones the connected opencode server is signed into,
 * and a way to sign into the rest. The UI counterpart of `opencode auth
 * login`.
 *
 * The catalog `provider.list()` returns is the whole of models.dev, hundreds
 * of entries, of which only a handful offer an interactive sign-in. So the
 * list is grouped — signed in, signable, everything else — rather than
 * filtered: what the server reports is all still here, just ordered by what
 * you can act on. Grouping is `toListItems`, a pure function tested
 * separately.
 *
 * @internal
 */
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import * as React from "react";
import { ActivityIndicator, FlatList, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAppContext } from "./AppContext";
import { colors } from "./colors";
import { loadProviders, toListItems, type ProviderListItem, type ProviderRow } from "./providerAuth";
import { ProviderSignIn } from "./ProviderSignIn";
import type { RootStackParamList } from "./RootNavigator";
import { SystemIcon } from "./SystemIcon";

type Props = NativeStackScreenProps<RootStackParamList, "Providers">;

export const ProvidersScreen = (props: Props): React.ReactElement => {
  const insets = useSafeAreaInsets();
  const { client } = useAppContext();

  const [rows, setRows] = React.useState<ReadonlyArray<ProviderRow>>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | undefined>(undefined);
  const [signingInto, setSigningInto] = React.useState<ProviderRow | undefined>(undefined);

  /**
   * A failed read leaves the previous rows alone and shows why. Replacing
   * them with an empty list would read as "you have no providers", which is a
   * different and untrue statement.
   */
  const load = React.useCallback(async (): Promise<void> => {
    const result = await loadProviders(client);
    if (result.ok) {
      setRows(result.rows);
      setError(undefined);
    } else {
      setError(result.message);
    }
    setLoading(false);
  }, [client]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const onSignedIn = React.useCallback((): void => {
    setSigningInto(undefined);
    setLoading(true);
    void load();
  }, [load]);

  const closeSignIn = React.useCallback((): void => {
    setSigningInto(undefined);
  }, []);

  const items = React.useMemo(() => toListItems(rows), [rows]);

  const renderItem = ({ item }: { item: ProviderListItem }): React.ReactElement => {
    if (item.kind === "section") {
      return (
        <View>
          <Text style={styles.sectionLabel}>{item.title}</Text>
          {item.hint === undefined ? null : <Text style={styles.sectionHint}>{item.hint}</Text>}
        </View>
      );
    }

    const { row } = item;
    // Nothing to open for a provider the server offers no sign-in for; the
    // row stays visible and inert rather than leading to an empty sheet.
    const signable = row.methods.length > 0;
    return (
      <TouchableOpacity
        style={[styles.row, item.first && styles.rowFirst, item.last && styles.rowLast]}
        activeOpacity={signable ? 0.6 : 1}
        disabled={!signable}
        onPress={() => setSigningInto(row)}
      >
        <Text style={styles.rowTitle} numberOfLines={1}>
          {row.name}
        </Text>
        <View style={styles.rowAccessory}>
          {row.signedIn ? <SystemIcon name="checkmark" size={15} color={colors.tint} /> : null}
          {signable ? <SystemIcon name="chevron.right" size={14} color={colors.secondaryLabel} /> : null}
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
        <Text style={styles.headerTitle}>Providers</Text>
        <View style={styles.backButton} />
      </View>

      <FlatList
        data={items}
        keyExtractor={(item) => item.key}
        renderItem={renderItem}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
        ListHeaderComponent={
          <>
            <Text style={styles.intro}>
              Signing in stores the credential on the opencode server this app is connected to.
            </Text>
            {error === undefined ? null : (
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
            )}
          </>
        }
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator style={styles.loading} size="small" color={colors.secondaryLabel} />
          ) : error === undefined ? (
            <Text style={styles.empty}>The server reported no providers.</Text>
          ) : null
        }
      />

      <ProviderSignIn row={signingInto} onClose={closeSignIn} onSignedIn={onSignedIn} />
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
    paddingTop: 8,
  },
  intro: {
    color: colors.secondaryLabel,
    fontSize: 13,
    lineHeight: 18,
    marginHorizontal: 4,
    marginTop: 8,
  },
  sectionLabel: {
    color: colors.secondaryLabel,
    fontSize: 13,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginTop: 28,
    marginBottom: 8,
    marginHorizontal: 4,
  },
  sectionHint: {
    color: colors.secondaryLabel,
    fontSize: 13,
    lineHeight: 18,
    marginHorizontal: 4,
    marginTop: -4,
    marginBottom: 8,
  },
  // Rows form one grouped card per section: a shared background with hairline
  // separators, rounded only at the section's first and last row.
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
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
  rowTitle: {
    flex: 1,
    color: colors.label,
    fontSize: 15,
    fontWeight: "500",
  },
  rowAccessory: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
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
    marginTop: 16,
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
