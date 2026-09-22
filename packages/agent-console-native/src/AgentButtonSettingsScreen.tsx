/**
 * Visibility settings for the assistant (Dubz) button: a master switch at the
 * top, then a per-surface switch for each place it can appear. Turning the
 * master off dims and disables the per-surface list. State lives in
 * `agentButtonSettings` (a live store), so toggles here reflect immediately
 * wherever the button renders.
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
import { colors } from "./colors";
import type { RootStackParamList } from "./RootNavigator";

type Props = NativeStackScreenProps<RootStackParamList, "AgentButtonSettings">;

export const AgentButtonSettingsScreen = (_props: Props): React.ReactElement => {
  const insets = useSafeAreaInsets();
  const settings = useAgentButtonSettings();

  return (
    <ScrollView
      style={styles.root}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
    >
      <View style={styles.card}>
        <View style={styles.row}>
          <Text style={styles.rowTitle}>Show {AGENT_NAME}</Text>
          <Switch value={settings.enabled} onValueChange={setAgentButtonEnabled} />
        </View>
      </View>
      <Text style={styles.hint}>
        {AGENT_NAME} is the app-wide assistant. Turn this off to hide the button everywhere; turn it on to
        choose where it appears below.
      </Text>

      <Text style={styles.sectionLabel}>Show in</Text>
      <View style={styles.card}>
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
      <Text style={styles.hint}>Each place the button can ride the bottom bar. Applies only while {AGENT_NAME} is on.</Text>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingHorizontal: 16,
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
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.separator,
    overflow: "hidden",
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
    color: colors.label,
    fontSize: 16,
  },
  rowTitleDim: {
    color: colors.tertiaryLabel,
  },
  hint: {
    color: colors.secondaryLabel,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 7,
    marginHorizontal: 5,
  },
});
