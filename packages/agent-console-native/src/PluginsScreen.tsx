/**
 * The plugin manager: every installed plugin, each opening its details (what
 * it adds and what it is allowed to do). Installing from the store lands here
 * next (docs/handoffs/double-agent-repo-screen-and-plugin-system.md §22.5).
 *
 * @internal
 */
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import * as React from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAppContext } from "./AppContext";
import { symbolForIcon } from "./codicons";
import { CardGlass } from "./CardGlass";
import { colors } from "./colors";
import type { InstalledPlugin } from "./pluginsClient";
import { refreshPlugins, usePlugins } from "./pluginsStore";
import type { RootStackParamList } from "./RootNavigator";
import { getApiAddress } from "./settings";
import { SystemIcon } from "./SystemIcon";

type Props = NativeStackScreenProps<RootStackParamList, "Plugins">;

/** A plugin's icon: its first page's, else a generic plugin glyph. */
const pluginIcon = (plugin: InstalledPlugin) => {
  const icon = plugin.pages.find((page) => page.icon !== undefined)?.icon;
  return icon === undefined ? "puzzlepiece.extension" : symbolForIcon(icon);
};

export const PluginsScreen = (props: Props): React.ReactElement => {
  const insets = useSafeAreaInsets();
  const { address } = useAppContext();
  const apiBase = getApiAddress(address);
  // Prefetched by Home, so this is normally already here; refresh behind it.
  const load = usePlugins();
  React.useEffect(() => {
    void refreshPlugins(apiBase);
  }, [apiBase]);
  const fetchPlugins = (): void => void refreshPlugins(apiBase);

  return (
    <ScrollView style={styles.root} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}>
      {load.kind === "loading" ? (
        <ActivityIndicator style={styles.spinner} color={colors.secondaryLabel} />
      ) : load.kind === "failed" ? (
        <View style={styles.center}>
          <Text style={styles.hint}>Couldn’t load plugins.</Text>
          <Text style={styles.detail}>{load.message}</Text>
          <TouchableOpacity onPress={fetchPlugins}>
            <Text style={styles.retry}>Try Again</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          {load.error === undefined ? null : <Text style={styles.staleNote}>Showing the last loaded list. Refreshing failed: {load.error}</Text>}
          <Text style={styles.sectionLabel}>Installed</Text>
          <View style={styles.card}>
            <CardGlass />
            {load.plugins.map((plugin, index) => (
              <TouchableOpacity
                key={plugin.id}
                style={[styles.row, index > 0 && styles.rowBorder]}
                activeOpacity={0.6}
                onPress={() => props.navigation.navigate("PluginDetail", { id: plugin.id, name: plugin.name })}
              >
                <View style={styles.icon}>
                  <SystemIcon name={pluginIcon(plugin)} size={20} color={colors.tint} />
                </View>
                <View style={styles.rowText}>
                  <Text style={styles.rowTitle}>{plugin.name}</Text>
                  <Text style={styles.rowMeta}>
                    {plugin.version} · {plugin.source === "built-in" ? "Built in" : plugin.source}
                  </Text>
                </View>
                <SystemIcon name="chevron.right" size={15} color={colors.secondaryLabel} />
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.hint}>Plugins add pages to your repos’ menus and tools to Dubz. Installing new ones from the store is coming next.</Text>
        </>
      )}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
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
  spinner: {
    marginTop: 40,
  },
  center: {
    alignItems: "center",
    gap: 10,
    marginTop: 40,
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
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.separator,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 11,
    minHeight: 56,
    gap: 12,
  },
  rowBorder: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.separator,
  },
  icon: {
    width: 28,
    alignItems: "center",
  },
  rowText: {
    flex: 1,
  },
  rowTitle: {
    color: colors.label,
    fontSize: 16,
  },
  rowMeta: {
    color: colors.secondaryLabel,
    fontSize: 13,
    marginTop: 2,
  },
  hint: {
    color: colors.secondaryLabel,
    fontSize: 13,
    marginTop: 8,
    marginHorizontal: 4,
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
