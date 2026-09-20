/**
 * The theme's `tokenColors`: the rules that colour code.
 *
 * An ordered list, not a map. VS Code resolves the rules in order with later
 * ones winning, so the order is meaningful and the list is never sorted for
 * display. Each row shows the rule's first scope, its foreground, and its font
 * style, since a rule commonly lists five or ten scopes and the full set never
 * fits on a row.
 *
 * @internal
 */
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import * as React from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors } from "./colors";
import type { RootStackParamList } from "./RootNavigator";
import { SystemIcon } from "./SystemIcon";
import { updateDraft, useThemeDraft } from "./themeDraft";
import { EMPTY_THEME, parseFontStyle, type VsCodeTheme } from "./vscodeTheme";

type Props = NativeStackScreenProps<RootStackParamList, "ThemeTokens">;

const StyleChips = (props: { readonly fontStyle: string | undefined }): React.ReactElement => {
  const flags = parseFontStyle(props.fontStyle);
  const shown: ReadonlyArray<readonly [string, boolean]> = [
    ["B", flags.bold],
    ["I", flags.italic],
    ["U", flags.underline],
    ["S", flags.strikethrough],
  ];
  return (
    <View style={styles.chips}>
      {shown
        .filter(([, on]) => on)
        .map(([letter]) => (
          <Text key={letter} style={styles.chip}>
            {letter}
          </Text>
        ))}
    </View>
  );
};

export const ThemeTokensScreen = (props: Props): React.ReactElement => {
  const insets = useSafeAreaInsets();
  const draft = useThemeDraft();
  const theme: VsCodeTheme = draft.kind === "open" ? draft.theme : EMPTY_THEME;

  const addRule = (): void => {
    updateDraft((current) => ({
      ...current,
      tokenColors: [...current.tokenColors, { scope: [], foreground: undefined, fontStyle: undefined }],
    }));
    props.navigation.navigate("ThemeTokenRule", { index: theme.tokenColors.length });
  };

  return (
    <ScrollView
      style={styles.root}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
    >
      <View style={styles.card}>
        {theme.tokenColors.map((rule, index) => (
          <TouchableOpacity
            key={`${index}:${rule.scope[0] ?? "empty"}`}
            style={[styles.row, index > 0 && styles.rowBorder]}
            activeOpacity={0.6}
            onPress={() => props.navigation.navigate("ThemeTokenRule", { index })}
          >
            <View
              style={[
                styles.swatch,
                rule.foreground === undefined ? styles.swatchEmpty : { backgroundColor: rule.foreground },
              ]}
            />
            <Text style={styles.scope} numberOfLines={1}>
              {rule.scope[0] ?? "No scope"}
              {rule.scope.length > 1 ? <Text style={styles.more}>{`  +${rule.scope.length - 1}`}</Text> : null}
            </Text>
            <StyleChips fontStyle={rule.fontStyle} />
            <SystemIcon name="chevron.right" size={13} color={colors.tertiaryLabel} />
          </TouchableOpacity>
        ))}
        <TouchableOpacity
          style={[styles.row, theme.tokenColors.length > 0 && styles.rowBorder]}
          activeOpacity={0.6}
          onPress={addRule}
        >
          <Text style={styles.addText}>Add rule…</Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.hint}>
        Rules apply in order and later ones win, so a rule added here overrides the ones above it.
      </Text>
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
    paddingTop: 10,
  },
  card: {
    backgroundColor: colors.cardBackground,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.separator,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
    minHeight: 46,
  },
  rowBorder: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.separator,
  },
  swatch: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.separator,
  },
  swatchEmpty: {
    backgroundColor: colors.fillBackground,
  },
  scope: {
    flex: 1,
    color: colors.label,
    fontSize: 14,
    fontFamily: "Menlo",
  },
  more: {
    color: colors.tertiaryLabel,
  },
  chips: {
    flexDirection: "row",
    gap: 4,
  },
  chip: {
    color: colors.tint,
    fontSize: 11,
    fontWeight: "700",
    backgroundColor: colors.accentTint,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 5,
    overflow: "hidden",
  },
  addText: {
    flex: 1,
    color: colors.tint,
    fontSize: 16,
  },
  hint: {
    color: colors.secondaryLabel,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 8,
    marginHorizontal: 5,
  },
});
