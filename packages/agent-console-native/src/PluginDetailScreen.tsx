/**
 * One installed plugin: what it is, the pages it adds (with what each needs to
 * open, which decides where it can go), and what it is allowed to do.
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
import { HeaderTitlePill } from "./HeaderTitlePill";
import { permissionText, requirementText, type InstalledPlugin } from "./pluginsClient";
import { refreshPlugins, usePlugins } from "./pluginsStore";
import type { RootStackParamList } from "./RootNavigator";
import { getApiAddress } from "./settings";
import { SystemIcon } from "./SystemIcon";
import { type TextColors, useTextColors, useThemedStyles } from "./theme";

type Props = NativeStackScreenProps<RootStackParamList, "PluginDetail">;

export const PluginDetailScreen = (props: Props): React.ReactElement => {
  const styles = useThemedStyles(makeStyles);
  const textColors = useTextColors();
  const { id, name } = props.route.params;
  const { navigation } = props;
  const insets = useSafeAreaInsets();
  const { address } = useAppContext();
  const apiBase = getApiAddress(address);
  // The manager's cached list: no loading step between it and here.
  const plugins = usePlugins();

  React.useLayoutEffect(() => {
    navigation.setOptions({ headerTitle: () => <HeaderTitlePill title={name} /> });
  }, [navigation, name]);

  React.useEffect(() => {
    if (plugins.kind !== "ready") void refreshPlugins(apiBase);
  }, [plugins.kind, apiBase]);
  const fetchPlugin = (): void => void refreshPlugins(apiBase);

  const found = plugins.kind === "ready" ? plugins.plugins.find((candidate) => candidate.id === id) : undefined;
  const load: { readonly kind: "loading" } | { readonly kind: "ready"; readonly plugin: InstalledPlugin } | { readonly kind: "failed"; readonly message: string } =
    plugins.kind === "loading"
      ? { kind: "loading" }
      : plugins.kind === "failed"
        ? { kind: "failed", message: plugins.message }
        : found === undefined
          ? { kind: "failed", message: `${id} is not installed.` }
          : { kind: "ready", plugin: found };

  if (load.kind !== "ready") {
    return (
      <View style={[styles.root, styles.center]}>
        {load.kind === "loading" ? (
          <ActivityIndicator color={textColors.secondaryLabel} />
        ) : (
          <>
            <Text style={styles.hint}>Couldn’t load this plugin.</Text>
            <Text style={styles.detail}>{load.message}</Text>
            <TouchableOpacity onPress={fetchPlugin}>
              <Text style={styles.retry}>Try Again</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    );
  }

  const { plugin } = load;
  return (
    <ScrollView style={styles.root} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}>
      <View style={styles.card}>
        <CardGlass />
        <View style={styles.row}>
          <Text style={styles.rowTitle}>Version</Text>
          <Text style={styles.rowValue}>{plugin.version}</Text>
        </View>
        <View style={[styles.row, styles.rowBorder]}>
          <Text style={styles.rowTitle}>Source</Text>
          <Text style={styles.rowValue}>{plugin.source === "built-in" ? "Built in" : plugin.source}</Text>
        </View>
        <View style={[styles.row, styles.rowBorder]}>
          <Text style={styles.rowTitle}>Identifier</Text>
          <Text style={styles.rowValueMono}>{plugin.id}</Text>
        </View>
      </View>
      {plugin.description === undefined ? null : <Text style={styles.hint}>{plugin.description}</Text>}

      <Text style={styles.sectionLabel}>Pages</Text>
      <View style={styles.card}>
        <CardGlass />
        {plugin.pages.length === 0 ? (
          <View style={styles.row}>
            <Text style={styles.rowValue}>This plugin adds no pages.</Text>
          </View>
        ) : (
          plugin.pages.map((page, index) => (
            <View key={page.id} style={[styles.row, index > 0 && styles.rowBorder]}>
              <View style={styles.icon}>
                <SystemIcon name={page.icon === undefined ? "doc" : symbolForIcon(page.icon)} size={18} color={colors.tint} />
              </View>
              <View style={styles.rowText}>
                <Text style={styles.rowTitle}>{page.title}</Text>
                <Text style={styles.rowMeta}>{requirementText(page.requirement)}</Text>
              </View>
            </View>
          ))
        )}
      </View>

      <Text style={styles.sectionLabel}>Permissions</Text>
      <View style={styles.card}>
        <CardGlass />
        {plugin.permissions.length === 0 ? (
          <View style={styles.row}>
            <Text style={styles.rowValue}>Reads your repos only.</Text>
          </View>
        ) : (
          plugin.permissions.map((permission, index) => (
            <View key={permission} style={[styles.row, index > 0 && styles.rowBorder]}>
              <Text style={styles.rowTitle}>{permissionText(permission)}</Text>
            </View>
          ))
        )}
      </View>
    </ScrollView>
  );
};

const makeStyles = (text: TextColors) =>
  StyleSheet.create({
  root: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  center: {
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  sectionLabel: {
    color: text.secondaryLabel,
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
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 11,
    minHeight: 48,
    gap: 12,
  },
  rowBorder: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.separator,
  },
  icon: {
    width: 24,
    alignItems: "center",
  },
  rowText: {
    flex: 1,
  },
  rowTitle: {
    color: text.label,
    fontSize: 16,
  },
  rowMeta: {
    color: text.secondaryLabel,
    fontSize: 13,
    marginTop: 2,
  },
  rowValue: {
    color: text.secondaryLabel,
    fontSize: 16,
  },
  rowValueMono: {
    color: text.secondaryLabel,
    fontSize: 13,
    fontFamily: "Menlo",
  },
  hint: {
    color: text.secondaryLabel,
    fontSize: 13,
    marginTop: 8,
    marginHorizontal: 4,
  },
  detail: {
    color: text.secondaryLabel,
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
