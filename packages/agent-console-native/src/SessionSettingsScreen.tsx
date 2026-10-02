/**
 * A session's own settings, opened from its chat's menu. For now its tool
 * permissions: allow all (tools run without asking) or ask before each
 * action (each waits for approval in the chat). Allowing all asks first: it
 * grants shell commands and delegation to subagents with their own
 * unrestricted permissions. Asking again takes effect at once.
 *
 * @internal
 */
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import * as React from "react";
import { ActionSheetIOS, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CARD_RADIUS, CardGlass } from "./CardGlass";
import { colors } from "./colors";
import type { RootStackParamList } from "./RootNavigator";
import { getPermissionMode, type PermissionMode, setPermissionMode } from "./sessionPermissions";
import { SystemIcon } from "./SystemIcon";
import { type TextColors, useTextColors, useThemedStyles } from "./theme";

type Props = NativeStackScreenProps<RootStackParamList, "SessionSettings">;

interface ModeOption {
  readonly mode: PermissionMode;
  readonly title: string;
  readonly detail: string;
}

const MODES: ReadonlyArray<ModeOption> = [
  { mode: "full", title: "Allow all", detail: "Tools run without asking." },
  { mode: "ask", title: "Ask before each action", detail: "Each tool action waits for your approval in the chat." },
];

export const SessionSettingsScreen = (props: Props): React.ReactElement => {
  const styles = useThemedStyles(makeStyles);
  const textColors = useTextColors();
  const insets = useSafeAreaInsets();
  const { sessionID } = props.route.params;
  const [mode, setMode] = React.useState<PermissionMode>(() => getPermissionMode(sessionID));

  const choose = (next: PermissionMode): void => {
    if (next === mode) return;
    const apply = (): void => {
      setPermissionMode(sessionID, next);
      setMode(next);
    };
    if (next === "ask") {
      apply();
      return;
    }
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: "Allow all tool actions?",
        message:
          "Tools run without asking for the rest of this session, including shell commands and delegating to a subagent that has its own unrestricted permissions.",
        options: ["Allow all", "Cancel"],
        destructiveButtonIndex: 0,
        cancelButtonIndex: 1,
      },
      (index) => {
        if (index === 0) apply();
      },
    );
  };

  return (
    <ScrollView style={styles.root} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}>
      <Text style={styles.sectionLabel}>Permissions</Text>
      <View style={styles.card}>
        <CardGlass />
        {MODES.map((option, index) => (
          <Pressable
            key={option.mode}
            style={[styles.row, index > 0 && styles.rowBorder]}
            accessibilityRole="radio"
            accessibilityState={{ checked: mode === option.mode }}
            onPress={() => choose(option.mode)}
          >
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>{option.title}</Text>
              <Text style={styles.rowDetail}>{option.detail}</Text>
            </View>
            {mode === option.mode ? <SystemIcon name="checkmark" size={16} color={textColors.label} /> : null}
          </Pressable>
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
      marginTop: 16,
      marginBottom: 6,
      marginLeft: 4,
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
      lineHeight: 18,
    },
  });
