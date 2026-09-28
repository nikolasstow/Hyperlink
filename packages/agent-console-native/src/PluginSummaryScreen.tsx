/**
 * A plugin's summary page, drawn natively: sections of facts (the NPM page's
 * package.json details, §23.1), then the plugin's pages that open from here
 * (Scripts).
 *
 * @internal
 */
import * as React from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useHeaderHeight } from "@react-navigation/elements";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAppContext } from "./AppContext";
import { symbolForIcon } from "./codicons";
import { colors } from "./colors";
import { ensureWorkspace } from "./extensionViewsStore";
import { loadSummary, useSummary } from "./pagesStore";
import type { RootStackParamList } from "./RootNavigator";
import { getApiAddress } from "./settings";
import { SystemIcon } from "./SystemIcon";

type Props = NativeStackScreenProps<RootStackParamList, "PluginSummary">;

export const PluginSummaryScreen = (props: Props): React.ReactElement => {
  const { repo, dir, page, title } = props.route.params;
  const { navigation } = props;
  const { address } = useAppContext();
  const apiBase = getApiAddress(address);
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const load = useSummary(dir, page);

  React.useEffect(() => {
    ensureWorkspace(apiBase, dir);
    void loadSummary(apiBase, dir, page, "ifChanged");
  }, [apiBase, dir, page]);

  const shownTitle = load.kind === "ready" ? load.value.title : title;
  React.useLayoutEffect(() => {
    navigation.setOptions({ title: shownTitle });
  }, [navigation, shownTitle]);

  if (load.kind !== "ready") {
    return (
      <View style={[styles.root, styles.center, { paddingTop: headerHeight + 40 }]}>
        {load.kind === "loading" ? (
          <ActivityIndicator color={colors.secondaryLabel} />
        ) : (
          <>
            <Text style={styles.message}>Couldn’t load {title}.</Text>
            <Text style={styles.detail}>{load.message}</Text>
            <TouchableOpacity onPress={() => void loadSummary(apiBase, dir, page, "force")}>
              <Text style={styles.retry}>Try Again</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    );
  }

  const summary = load.value;
  return (
    <ScrollView
      style={styles.root}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
      refreshControl={<RefreshControl refreshing={load.refreshing} onRefresh={() => void loadSummary(apiBase, dir, page, "force")} />}
    >
      {load.error === undefined ? null : <Text style={styles.staleNote}>Showing the last loaded summary. Refreshing failed: {load.error}</Text>}
      {summary.links.length === 0 ? null : (
        <View style={[styles.card, styles.firstCard]}>
          {summary.links.map((link, index) => (
            <Pressable
              key={link.page}
              style={[styles.row, index > 0 && styles.rowBorder]}
              onPress={() => {
                if (link.kind === "collection") navigation.navigate("Collection", { repo, dir, page: link.page, title: link.title, view: { kind: "home" } });
                else if (link.kind === "summary") navigation.push("PluginSummary", { repo, dir, page: link.page, title: link.title });
                else navigation.navigate("ExtensionView", { repo, dir, view: link.page, title: link.title });
              }}
            >
              <SystemIcon name={symbolForIcon(link.icon)} size={19} color={colors.tint} />
              <Text style={styles.linkTitle}>{link.title}</Text>
              <SystemIcon name="chevron.forward" size={13} color={colors.secondaryLabel} />
            </Pressable>
          ))}
        </View>
      )}
      {summary.sections.map((section, sectionIndex) => (
        <View key={section.title ?? `section ${sectionIndex}`}>
          {section.title === undefined ? <View style={styles.gap} /> : <Text style={styles.sectionLabel}>{section.title}</Text>}
          <View style={styles.card}>
            {section.rows.map((row, index) => (
              <View key={row.label} style={[styles.row, styles.factRow, index > 0 && styles.rowBorder]}>
                <Text style={styles.factLabel}>{row.label}</Text>
                <Text style={[styles.factValue, row.mono && styles.mono]} selectable>
                  {row.value}
                </Text>
              </View>
            ))}
          </View>
        </View>
      ))}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  center: {
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 24,
  },
  content: {
    paddingHorizontal: 16,
  },
  staleNote: {
    color: colors.warning,
    fontSize: 12,
    marginTop: 12,
    marginHorizontal: 4,
  },
  firstCard: {
    marginTop: 16,
  },
  gap: {
    height: 24,
  },
  sectionLabel: {
    color: colors.secondaryLabel,
    fontSize: 13,
    textTransform: "uppercase",
    marginTop: 24,
    marginBottom: 6,
    marginLeft: 4,
  },
  card: {
    backgroundColor: colors.cardBackground,
    borderRadius: 14,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  factRow: {
    alignItems: "flex-start",
  },
  rowBorder: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.separator,
  },
  linkTitle: {
    flex: 1,
    color: colors.label,
    fontSize: 16,
  },
  factLabel: {
    color: colors.label,
    fontSize: 16,
  },
  factValue: {
    flex: 1,
    color: colors.secondaryLabel,
    fontSize: 16,
    textAlign: "right",
  },
  mono: {
    fontFamily: "Menlo",
    fontSize: 14,
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
