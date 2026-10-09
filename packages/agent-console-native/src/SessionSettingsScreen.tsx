/**
 * A session's own settings, opened from its chat's menu: its background and
 * its tool permissions.
 *
 * Background: a colour for light mode and one for dark, each beside the
 * colour it inherits from the app (Appearance → Background, or the system's)
 * — that swatch is the way back to it. Permissions: allow all (tools run without asking) or ask before each
 * action (each waits for approval in the chat). Allowing all asks first: it
 * grants shell commands and delegation to subagents with their own
 * unrestricted permissions. Asking again takes effect at once.
 *
 * @internal
 */
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import * as React from "react";
import { ColorPicker, Host } from "@expo/ui/swift-ui";
import { ActionSheetIOS, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CARD_RADIUS, CardGlass } from "./CardGlass";
import { colors } from "./colors";
import type { RootStackParamList } from "./RootNavigator";
import { getPermissionMode, type PermissionMode, setPermissionMode } from "./sessionPermissions";
import { SystemIcon } from "./SystemIcon";
import type { BackgroundMode } from "./sessions/SessionBackgrounds";
import { setSessionBackground, useSessionBackground } from "./sessions/useSessionBackground";
import { resolveThemeColors } from "./shikiHighlighter";
import { type TextColors, useTextColors, useTheme, useThemedStyles } from "./theme";
import { useResolvedCodeTheme } from "./useCodeTheme";
import { toOpaqueHex } from "./vscodeTheme";

type Props = NativeStackScreenProps<RootStackParamList, "SessionSettings">;

interface ModeOption {
  readonly mode: PermissionMode;
  readonly title: string;
  readonly detail: string;
}

/** The system's screen background in each mode (systemGroupedBackground). */
const SYSTEM_BACKGROUND: Readonly<Record<BackgroundMode, string>> = { light: "#F2F2F7", dark: "#000000" };

const isHex = (value: string): boolean => /^#[0-9a-fA-F]{6}$/.test(value);
const eq = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

/** One mode's session background, as an ordered set of swatches: Default (the
 * blackish/whitish system background), Inherit (follow the app — selected while
 * the session has none of its own), Theme (the enabled theme's background for
 * this mode), then Apple's picker for anything custom. */
const BackgroundRow = (props: {
  readonly label: string;
  readonly value: string | undefined;
  /** The colour the session inherits from the app (its Appearance background,
   * or the system's) — shown on the Inherit swatch. */
  readonly inherited: string;
  /** The blackish/whitish system background for this mode. */
  readonly systemColor: string;
  /** The enabled theme's background for this mode, when it resolves to one. */
  readonly themeColor: string | undefined;
  readonly onChange: (color: string | undefined) => void;
}): React.ReactElement => {
  const styles = useThemedStyles(makeStyles);
  const selected = props.value;
  return (
    <View style={styles.backgroundRow}>
      <Text style={styles.backgroundLabel}>{props.label}</Text>
      {/* Default — blackish in dark, whitish in light. */}
      <TouchableOpacity
        accessibilityLabel={`${props.label} background: Default`}
        accessibilityState={{ selected: selected !== undefined && eq(selected, props.systemColor) }}
        onPress={() => props.onChange(props.systemColor)}
        style={[styles.swatch, { backgroundColor: props.systemColor }, selected !== undefined && eq(selected, props.systemColor) ? styles.swatchSelected : null]}
      />
      {/* Inherit — follow the app; no session override. */}
      <TouchableOpacity
        accessibilityLabel={`${props.label} background: Inherit`}
        accessibilityState={{ selected: selected === undefined }}
        onPress={() => props.onChange(undefined)}
        style={[styles.swatch, { backgroundColor: props.inherited }, selected === undefined ? styles.swatchSelected : null]}
      >
        <SystemIcon name="arrow.down.left.circle" size={13} color={colors.secondaryLabel} />
      </TouchableOpacity>
      {/* Theme — the enabled theme's background for this mode. */}
      {props.themeColor === undefined ? null : (
        <TouchableOpacity
          accessibilityLabel={`${props.label} background: Theme`}
          accessibilityState={{ selected: selected !== undefined && eq(selected, props.themeColor) }}
          onPress={() => props.themeColor !== undefined && props.onChange(props.themeColor)}
          style={[styles.swatch, { backgroundColor: props.themeColor }, selected !== undefined && eq(selected, props.themeColor) ? styles.swatchSelected : null]}
        >
          <SystemIcon name="paintpalette.fill" size={12} color="#FFFFFF" />
        </TouchableOpacity>
      )}
      {/* Custom — Apple's colour picker. */}
      <Host style={styles.pickerSwatch}>
        <ColorPicker
          label=""
          selection={props.value ?? props.inherited}
          onSelectionChange={(next) => {
            const hex = next.length >= 7 ? next.slice(0, 7) : next;
            if (isHex(hex)) props.onChange(hex.toUpperCase());
          }}
        />
      </Host>
    </View>
  );
};

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
  const { theme } = useTheme();
  // The enabled theme's actual background per mode (resolved, so it is present
  // even for the bundled fallback) — the Theme swatch.
  const lightThemeBg = toOpaqueHex(resolveThemeColors(useResolvedCodeTheme(theme.code, "light")).colors["editor.background"]);
  const darkThemeBg = toOpaqueHex(resolveThemeColors(useResolvedCodeTheme(theme.codeDark ?? theme.code, "dark")).colors["editor.background"]);
  const background = useSessionBackground(sessionID);
  const setBackground = (backgroundMode: BackgroundMode) => (color: string | undefined) => {
    setSessionBackground(sessionID, backgroundMode, color).catch((error: unknown) => console.error("[session settings] saving the background failed", error));
  };

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
      <Text style={styles.sectionLabel}>Background</Text>
      <View style={styles.card}>
        <CardGlass />
        <BackgroundRow
          label="Light"
          value={background?.light}
          inherited={theme.backgroundLight ?? SYSTEM_BACKGROUND.light}
          systemColor={SYSTEM_BACKGROUND.light}
          themeColor={lightThemeBg}
          onChange={setBackground("light")}
        />
        <View style={styles.rowBorder} />
        <BackgroundRow
          label="Dark"
          value={background?.dark}
          inherited={theme.backgroundDark ?? SYSTEM_BACKGROUND.dark}
          systemColor={SYSTEM_BACKGROUND.dark}
          themeColor={darkThemeBg}
          onChange={setBackground("dark")}
        />
      </View>

      <Text style={[styles.sectionLabel, styles.sectionGap]}>Permissions</Text>
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
    backgroundLabel: {
      flex: 1,
      color: text.label,
      fontSize: 16,
    },
    sectionGap: {
      marginTop: 28,
    },
    backgroundRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 14,
      paddingHorizontal: 14,
      minHeight: 52,
    },
    swatch: {
      width: 32,
      height: 32,
      borderRadius: 16,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.separator,
      alignItems: "center",
      justifyContent: "center",
    },
    swatchSelected: {
      borderWidth: 3,
      borderColor: text.label,
    },
    pickerSwatch: {
      width: 32,
      height: 32,
    },
    rowDetail: {
      color: text.secondaryLabel,
      fontSize: 13,
      lineHeight: 18,
    },
  });
