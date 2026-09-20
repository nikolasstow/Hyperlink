/**
 * One `tokenColors` rule: the scopes it matches, its foreground, and its font
 * style.
 *
 * That is the whole of a rule. VS Code token rules carry a foreground and a
 * font style and nothing else, so there is no background here and no typeface:
 * the code font is an app preference rather than part of a theme. Saying so on
 * the screen saves hunting for a control that cannot exist.
 *
 * @internal
 */
import { ColorPicker, Host } from "@expo/ui/swift-ui";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import * as React from "react";
import { ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors } from "./colors";
import type { RootStackParamList } from "./RootNavigator";
import { updateDraft, useThemeDraft } from "./themeDraft";
import {
  EMPTY_THEME,
  formatFontStyle,
  isHexColor,
  parseFontStyle,
  type FontStyleFlags,
  type TokenRule,
  type VsCodeTheme,
} from "./vscodeTheme";

type Props = NativeStackScreenProps<RootStackParamList, "ThemeTokenRule">;

const DEFAULT_FOREGROUND = "#808080";

const STYLE_FIELDS: ReadonlyArray<readonly [keyof FontStyleFlags, string]> = [
  ["bold", "Bold"],
  ["italic", "Italic"],
  ["underline", "Underline"],
  ["strikethrough", "Strikethrough"],
];

export const ThemeTokenRuleScreen = (props: Props): React.ReactElement => {
  const { index } = props.route.params;
  const insets = useSafeAreaInsets();
  const draft = useThemeDraft();
  const theme: VsCodeTheme = draft.kind === "open" ? draft.theme : EMPTY_THEME;
  const rule = theme.tokenColors[index];

  const [newScope, setNewScope] = React.useState("");

  const replace = React.useCallback(
    (change: (current: TokenRule) => TokenRule): void => {
      updateDraft((current) => {
        const target = current.tokenColors[index];
        if (target === undefined) return current;
        const next = [...current.tokenColors];
        next[index] = change(target);
        return { ...current, tokenColors: next };
      });
    },
    [index],
  );

  const removeRule = (): void => {
    updateDraft((current) => ({
      ...current,
      tokenColors: current.tokenColors.filter((_, position) => position !== index),
    }));
    props.navigation.goBack();
  };

  if (rule === undefined) {
    return (
      <View style={styles.root}>
        <Text style={styles.empty}>This rule is no longer part of the theme.</Text>
      </View>
    );
  }

  const flags = parseFontStyle(rule.fontStyle);
  const foreground = rule.foreground;

  const addScope = (): void => {
    const scope = newScope.trim();
    if (scope.length === 0) return;
    setNewScope("");
    replace((current) => ({ ...current, scope: [...current.scope, scope] }));
  };

  return (
    <ScrollView
      style={styles.root}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.sectionLabel}>Scopes · {rule.scope.length}</Text>
      <View style={styles.card}>
        {rule.scope.map((scope, position) => (
          <View key={`${position}:${scope}`} style={[styles.row, position > 0 && styles.rowBorder]}>
            <Text style={styles.scope} numberOfLines={1}>
              {scope}
            </Text>
            <TouchableOpacity
              activeOpacity={0.6}
              accessibilityLabel={`Remove ${scope}`}
              onPress={() => replace((current) => ({ ...current, scope: current.scope.filter((_, i) => i !== position) }))}
            >
              <Text style={styles.remove}>Remove</Text>
            </TouchableOpacity>
          </View>
        ))}
        <View style={[styles.row, rule.scope.length > 0 && styles.rowBorder]}>
          <TextInput
            style={styles.scopeInput}
            value={newScope}
            onChangeText={setNewScope}
            onSubmitEditing={addScope}
            placeholder="Add scope, e.g. entity.name.function"
            placeholderTextColor={colors.placeholderText}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="done"
          />
          <TouchableOpacity activeOpacity={0.6} onPress={addScope} disabled={newScope.trim().length === 0}>
            <Text style={[styles.add, newScope.trim().length === 0 && styles.addDim]}>Add</Text>
          </TouchableOpacity>
        </View>
      </View>

      <Text style={styles.sectionLabel}>Foreground</Text>
      <View style={styles.card}>
        <View style={styles.row}>
          <Text style={styles.rowTitle}>Colour</Text>
          <Text style={styles.rowValue}>{(foreground ?? "Not set").toUpperCase()}</Text>
          <Host style={styles.picker} matchContents>
            <ColorPicker
              label=""
              selection={foreground ?? DEFAULT_FOREGROUND}
              supportsOpacity
              onSelectionChange={(next) => {
                if (isHexColor(next)) replace((current) => ({ ...current, foreground: next }));
              }}
            />
          </Host>
        </View>
        {foreground === undefined ? null : (
          <TouchableOpacity
            style={[styles.row, styles.rowBorder]}
            activeOpacity={0.6}
            onPress={() => replace((current) => ({ ...current, foreground: undefined }))}
          >
            <Text style={styles.remove}>Unset colour</Text>
          </TouchableOpacity>
        )}
      </View>

      <Text style={styles.sectionLabel}>Font style</Text>
      <View style={styles.card}>
        {STYLE_FIELDS.map(([field, label], position) => (
          <View key={field} style={[styles.row, position > 0 && styles.rowBorder]}>
            <Text style={styles.rowTitle}>{label}</Text>
            <Switch
              value={flags[field]}
              onValueChange={(on) =>
                replace((current) => ({
                  ...current,
                  fontStyle: formatFontStyle({ ...parseFontStyle(current.fontStyle), [field]: on }),
                }))
              }
            />
          </View>
        ))}
      </View>
      <Text style={styles.hint}>
        A VS Code token rule carries a foreground and a font style. There is no background, and the code
        typeface is an app setting rather than part of a theme.
      </Text>

      <TouchableOpacity style={styles.deleteButton} activeOpacity={0.6} onPress={removeRule}>
        <Text style={styles.deleteText}>Delete rule</Text>
      </TouchableOpacity>
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
    paddingTop: 4,
  },
  sectionLabel: {
    color: colors.secondaryLabel,
    fontSize: 13,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginTop: 22,
    marginBottom: 8,
    marginHorizontal: 4,
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
    paddingVertical: 10,
    minHeight: 46,
  },
  rowBorder: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.separator,
  },
  rowTitle: {
    flex: 1,
    color: colors.label,
    fontSize: 16,
  },
  rowValue: {
    color: colors.secondaryLabel,
    fontSize: 13,
    fontFamily: "Menlo",
  },
  scope: {
    flex: 1,
    color: colors.label,
    fontSize: 14,
    fontFamily: "Menlo",
  },
  scopeInput: {
    flex: 1,
    color: colors.label,
    fontSize: 14,
    fontFamily: "Menlo",
    padding: 0,
  },
  picker: {
    width: 36,
    height: 36,
  },
  add: {
    color: colors.tint,
    fontSize: 15,
    fontWeight: "600",
  },
  addDim: {
    opacity: 0.35,
  },
  remove: {
    color: colors.destructive,
    fontSize: 14,
  },
  hint: {
    color: colors.secondaryLabel,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 8,
    marginHorizontal: 5,
  },
  deleteButton: {
    marginTop: 24,
    paddingVertical: 13,
    borderRadius: 12,
    backgroundColor: colors.fillBackground,
    alignItems: "center",
  },
  deleteText: {
    color: colors.destructive,
    fontSize: 16,
    fontWeight: "600",
  },
  empty: {
    color: colors.secondaryLabel,
    fontSize: 15,
    padding: 24,
  },
});
