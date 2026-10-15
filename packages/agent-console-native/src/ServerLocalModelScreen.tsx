/**
 * The server's local model (Server → Services → Local model): the model the
 * API server runs on its own machine for inline suggestions (llama.cpp with a
 * Qwen2.5-Coder model; docs/handoffs/code-intelligence.md). The server starts
 * it, watches it, and starts it again if it stops; here it is turned on or
 * off, its model chosen, llama.cpp installed when it is missing, and it is
 * restarted. Its state shows live.
 *
 * @internal
 */
import { useHeaderHeight } from "@react-navigation/elements";
import { LocalModel } from "agent-console-protocol";
import * as React from "react";
import { ActivityIndicator, type ColorValue, Pressable, ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CARD_RADIUS, CardGlass } from "./CardGlass";
import { colors } from "./colors";
import { useLocalModel } from "./localModel/useLocalModel";
import { SystemIcon } from "./SystemIcon";
import { type TextColors, useScreenBackground, useTextColors, useThemedStyles } from "./theme";

const GREEN = "#32d74b";
const AMBER = "#ffd60a";
const RED = "#ff453a";

/** Each state, as the page says it, and its light's colour. */
const STATES: Readonly<Record<LocalModel.State, { readonly label: string; readonly color: ColorValue }>> = {
  off: { label: "Off", color: colors.secondaryLabel },
  "not-installed": { label: "llama.cpp not installed", color: AMBER },
  installing: { label: "Installing llama.cpp…", color: AMBER },
  starting: { label: "Starting…", color: AMBER },
  ready: { label: "Ready", color: GREEN },
  failed: { label: "Stopped", color: RED },
};

export const ServerLocalModelScreen = (): React.ReactElement => {
  const styles = useThemedStyles(makeStyles);
  const textColors = useTextColors();
  const background = useScreenBackground("grouped");
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const { overview, error, setSettings, install, restart } = useLocalModel();

  if (overview === undefined) {
    return (
      <View style={[styles.center, { backgroundColor: background }]}>
        {error === undefined ? <ActivityIndicator /> : <Text style={styles.note}>Couldn’t reach the server.</Text>}
      </View>
    );
  }
  const { settings, status } = overview;
  const shown = STATES[status.state];
  const busy = status.state === "installing" || status.state === "starting";

  return (
    <ScrollView
      style={{ backgroundColor: background }}
      contentInsetAdjustmentBehavior="never"
      contentContainerStyle={{ paddingHorizontal: 16, paddingTop: headerHeight + 8, paddingBottom: insets.bottom + 32 }}
    >
      <View style={styles.card}>
        <CardGlass />
        <View style={styles.row}>
          <View style={styles.rowText}>
            <Text style={styles.rowTitle}>Run on the server</Text>
            <Text style={styles.rowDetail}>Inline suggestions in the editor, on this server’s own machine.</Text>
          </View>
          <Switch value={settings.enabled} onValueChange={(enabled) => setSettings({ ...settings, enabled })} />
        </View>
        <View style={[styles.row, styles.rowBorder]}>
          <View style={[styles.light, { backgroundColor: shown.color }]} />
          <View style={styles.rowText}>
            <Text style={styles.rowTitle}>{shown.label}</Text>
            {status.message === undefined ? null : (
              <Text style={styles.rowDetail} numberOfLines={3}>
                {status.message}
              </Text>
            )}
          </View>
          {busy ? <ActivityIndicator /> : null}
        </View>
      </View>
      {error === undefined ? null : <Text style={styles.error}>{error}</Text>}

      <Text style={styles.sectionLabel}>Model</Text>
      <View style={styles.card}>
        <CardGlass />
        {LocalModel.MODELS.map((model, index) => (
          <Pressable
            key={model.id}
            style={[styles.row, index > 0 && styles.rowBorder]}
            accessibilityRole="radio"
            accessibilityState={{ checked: settings.model === model.id }}
            onPress={() => {
              if (model.id !== settings.model) setSettings({ ...settings, model: model.id });
            }}
          >
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>{model.name}</Text>
              <Text style={styles.rowDetail}>{model.note}</Text>
            </View>
            {settings.model === model.id ? <SystemIcon name="checkmark" size={16} color={textColors.label} /> : null}
          </Pressable>
        ))}
      </View>
      <Text style={styles.note}>A model is downloaded the first time it starts.</Text>

      <View style={[styles.card, styles.sectionGap]}>
        <CardGlass />
        {status.state === "not-installed" ? (
          <TouchableOpacity style={styles.row} activeOpacity={0.6} onPress={install}>
            <SystemIcon name="arrow.down.circle" size={18} color={colors.tint} />
            <Text style={styles.action}>Install llama.cpp</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={styles.row} activeOpacity={0.6} disabled={!settings.enabled} onPress={restart}>
            <SystemIcon name="arrow.clockwise" size={18} color={settings.enabled ? colors.tint : textColors.secondaryLabel} />
            <Text style={[styles.action, !settings.enabled && styles.actionOff]}>Restart</Text>
          </TouchableOpacity>
        )}
      </View>
    </ScrollView>
  );
};

const makeStyles = (text: TextColors) =>
  StyleSheet.create({
    center: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
    },
    sectionLabel: {
      color: text.secondaryLabel,
      fontSize: 13,
      textTransform: "uppercase",
      marginTop: 28,
      marginBottom: 6,
      marginLeft: 4,
    },
    sectionGap: {
      marginTop: 28,
    },
    card: {
      borderRadius: CARD_RADIUS,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.separator,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      paddingHorizontal: 14,
      paddingVertical: 11,
      minHeight: 56,
    },
    rowBorder: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.separator,
    },
    rowText: {
      flex: 1,
      gap: 2,
    },
    rowTitle: {
      color: text.label,
      fontSize: 16,
    },
    rowDetail: {
      color: text.secondaryLabel,
      fontSize: 13,
    },
    light: {
      width: 10,
      height: 10,
      borderRadius: 5,
    },
    action: {
      color: colors.tint,
      fontSize: 16,
    },
    actionOff: {
      color: text.secondaryLabel,
    },
    note: {
      color: text.secondaryLabel,
      fontSize: 13,
      marginTop: 8,
      marginHorizontal: 4,
    },
    error: {
      color: RED,
      fontSize: 13,
      marginTop: 8,
      marginHorizontal: 4,
    },
  });
