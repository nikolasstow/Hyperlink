/**
 * Where the assistant (Dubz) is a page of the bottom bar: a master switch at
 * the top, then a per-surface switch for each place it can appear. Turning the
 * master off dims and disables the per-surface list. State lives in
 * `agentButtonSettings` (a live store), so toggles here reflect immediately
 * in every bar.
 *
 * @internal
 */
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import * as React from "react";
import { ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AGENT_NAME } from "./agentButtonSettings";
import {
  AGENT_SURFACES,
  setAgentButtonEnabled,
  setAgentSurfaceEnabled,
  useAgentButtonSettings,
} from "./agentButtonSettings";
import { CardGlass } from "./CardGlass";
import { colors } from "./colors";
import type { RootStackParamList } from "./RootNavigator";
import { type TextColors, useThemedStyles } from "./theme";

type Props = NativeStackScreenProps<RootStackParamList, "AgentButtonSettings">;

export const AgentButtonSettingsScreen = (_props: Props): React.ReactElement => {
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const settings = useAgentButtonSettings();

  return (
    <ScrollView
      style={styles.root}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
    >
      <View style={styles.card}>
        <CardGlass />
        <View style={styles.row}>
          <Text style={styles.rowTitle}>Show {AGENT_NAME}</Text>
          <Switch value={settings.enabled} onValueChange={setAgentButtonEnabled} />
        </View>
      </View>

      <Text style={styles.sectionLabel}>Show in</Text>
      <View style={styles.card}>
        <CardGlass />
        {AGENT_SURFACES.map((surface, index) => (
          <View key={surface.key} style={[styles.row, index > 0 && styles.rowBorder]}>
            <Text style={[styles.rowTitle, !settings.enabled && styles.rowTitleDim]}>{surface.label}</Text>
            <Switch
              value={settings.surfaces[surface.key]}
              disabled={!settings.enabled}
              onValueChange={(on) => setAgentSurfaceEnabled(surface.key, on)}
            />
          </View>
        ))}
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
    marginTop: 16,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 11,
    minHeight: 48,
  },
  rowBorder: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.separator,
  },
  rowTitle: {
    color: text.label,
    fontSize: 16,
  },
  rowTitleDim: {
    color: text.tertiaryLabel,
  },
  hint: {
    color: text.secondaryLabel,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 7,
    marginHorizontal: 5,
  },
});
