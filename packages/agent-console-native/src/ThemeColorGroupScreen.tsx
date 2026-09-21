/**
 * One group of workbench colours, and the screen where they are actually
 * edited.
 *
 * Each row is a real `ColorPicker` from `@expo/ui/swift-ui`, which presents
 * Apple's own `UIColorPickerViewController`: Grid, Spectrum and Sliders tabs, a
 * hex field, the eyedropper, and favourites that carry across the system. Its
 * `selection` prop is a `#RRGGBB` / `#RRGGBBAA` string, which is exactly the
 * colour form VS Code themes are written in, so the value moves between the
 * control and the document with no conversion.
 *
 * Keys a theme has not set are listed below the ones it has, because a theme
 * defines a subset of the roughly six hundred keys VS Code knows and the rest
 * inherit its defaults. Adding one is a tap, which is what makes every key in
 * the group reachable without rendering six hundred inert rows.
 *
 * @internal
 */
import { Host, ColorPicker } from "@expo/ui/swift-ui";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import * as React from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors } from "./colors";
import type { RootStackParamList } from "./RootNavigator";
import { THEME_COLOR_KEYS } from "./themeColorKeys";
import { updateDraft, useThemeDraft } from "./themeDraft";
import {
  ALL_COLOR_GROUPS,
  EMPTY_THEME,
  groupIdOf,
  groupPrefixOf,
  humanizeKey,
  isPickedColorChange,
  normalizePickedColor,
  type VsCodeTheme,
} from "./vscodeTheme";

type Props = NativeStackScreenProps<RootStackParamList, "ThemeColorGroup">;

/** A sensible starting colour when adding a key that has never been set. */
const SEED_COLOR = "#808080";

const setColor = (key: string, value: string): void =>
  updateDraft((theme) => ({ ...theme, colors: { ...theme.colors, [key]: value } }));

const clearColor = (key: string): void =>
  updateDraft((theme) => {
    const next: Record<string, string> = { ...theme.colors };
    // Removing the key is the point: an unset key inherits VS Code’s default,
    // which is a different instruction from setting it to any particular value.
    delete next[key];
    return { ...theme, colors: next };
  });

const ColorRow = (props: {
  readonly themeKey: string;
  readonly value: string;
  readonly label: string;
  readonly first: boolean;
  /** View-only: show the colour as a static swatch, with no picker or Unset. */
  readonly readonly: boolean;
}): React.ReactElement => (
  <View style={[styles.row, !props.first && styles.rowBorder]}>
    <View style={styles.rowText}>
      <Text style={styles.rowTitle} numberOfLines={1}>
        {props.label}
      </Text>
      <Text style={styles.rowKey} numberOfLines={1}>
        {props.themeKey}
      </Text>
    </View>
    <Text style={styles.rowValue}>{props.value.toUpperCase()}</Text>
    {props.readonly ? (
      <View style={[styles.staticSwatch, { backgroundColor: props.value }]} />
    ) : (
      <>
        {/* The swatch is Apple's control, not ours: tapping it opens the system
         * picker. `supportsOpacity` matters because plenty of real theme keys
         * (selections, overlays, highlights) are deliberately translucent. */}
        <Host style={styles.picker} matchContents>
          <ColorPicker
            label=""
            selection={props.value}
            supportsOpacity
            onSelectionChange={(next) => {
              // The picker answers in eight uppercase digits whatever it was
              // handed, so the reported value is read back into the key's own
              // notation before it is compared or stored.
              if (isPickedColorChange(next, props.value)) {
                setColor(props.themeKey, normalizePickedColor(next, props.value));
              }
            }}
          />
        </Host>
        <TouchableOpacity
          style={styles.clear}
          activeOpacity={0.6}
          accessibilityLabel={`Unset ${props.label}`}
          onPress={() => clearColor(props.themeKey)}
        >
          <Text style={styles.clearText}>Unset</Text>
        </TouchableOpacity>
      </>
    )}
  </View>
);

export const ThemeColorGroupScreen = (props: Props): React.ReactElement => {
  const { groupId, focusKey } = props.route.params;
  const insets = useSafeAreaInsets();
  const draft = useThemeDraft();
  const theme: VsCodeTheme = draft.kind === "open" ? draft.theme : EMPTY_THEME;
  const readonly = draft.kind === "open" && draft.readonly;

  const group = ALL_COLOR_GROUPS.find((candidate) => candidate.id === groupId);

  // A search result arrives with `groupId: "search"` and one key to show, so
  // the same screen serves both a whole group and a single hit.
  const keys = React.useMemo(() => {
    // A focused key the theme has not set belongs in the Add list below, not
    // here: search can now reach a key that has never been given a value.
    if (focusKey !== undefined) return theme.colors[focusKey] === undefined ? [] : [focusKey];
    return Object.keys(theme.colors)
      .filter((key) => groupIdOf(key) === groupId)
      .sort((a, b) => a.localeCompare(b));
  }, [theme.colors, groupId, focusKey]);

  /** Every known key this group claims that the theme has not set — from the
   * bundled catalog (THEME_COLOR_KEYS), so a blank theme still offers them all
   * without needing an import. */
  const unset = React.useMemo(() => {
    // Nothing to add in a read-only theme, so the whole "Not set" section drops.
    if (readonly) return [];
    // One focused key from search, offered when the theme has not set it.
    if (focusKey !== undefined) return theme.colors[focusKey] === undefined ? [focusKey] : [];
    if (group === undefined) return [];
    const set = new Set(Object.keys(theme.colors));
    return THEME_COLOR_KEYS.filter((key) => !set.has(key) && groupIdOf(key) === groupId).sort((a, b) => a.localeCompare(b));
  }, [group, groupId, theme.colors, focusKey, readonly]);

  React.useLayoutEffect(() => {
    props.navigation.setOptions({ title: focusKey !== undefined ? "Color" : (group?.title ?? "Colors") });
  }, [props.navigation, group, focusKey]);

  return (
    <ScrollView
      style={styles.root}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
    >
      <Text style={styles.sectionLabel}>Set in this theme · {keys.length}</Text>
      <View style={styles.card}>
        {keys.length === 0 ? (
          <Text style={styles.empty}>
            {focusKey === undefined ? "Nothing set in this group." : "This theme does not set this key."}
          </Text>
        ) : (
          keys.map((key, index) => {
            const value = theme.colors[key];
            if (value === undefined) return null;
            return (
              <ColorRow
                key={key}
                themeKey={key}
                value={value}
                label={humanizeKey(key, focusKey === undefined ? groupPrefixOf(key) : undefined)}
                first={index === 0}
                readonly={readonly}
              />
            );
          })
        )}
      </View>

      {unset.length === 0 ? null : (
        <>
          <Text style={styles.sectionLabel}>Not set · {unset.length}</Text>
          <View style={styles.card}>
            {unset.map((key, index) => (
              <TouchableOpacity
                key={key}
                style={[styles.row, index > 0 && styles.rowBorder]}
                activeOpacity={0.6}
                onPress={() => setColor(key, SEED_COLOR)}
              >
                <View style={styles.rowText}>
                  <Text style={styles.rowTitleDim} numberOfLines={1}>
                    {humanizeKey(key, groupPrefixOf(key))}
                  </Text>
                  <Text style={styles.rowKey} numberOfLines={1}>
                    {key}
                  </Text>
                </View>
                <Text style={styles.addText}>Add</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.hint}>
            A key this theme does not set inherits VS Code’s default for a {theme.type} theme.
          </Text>
        </>
      )}
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
    paddingVertical: 9,
    minHeight: 52,
  },
  rowBorder: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.separator,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
  },
  rowTitle: {
    color: colors.label,
    fontSize: 15,
  },
  rowTitleDim: {
    color: colors.secondaryLabel,
    fontSize: 15,
  },
  rowKey: {
    color: colors.tertiaryLabel,
    fontSize: 11,
    fontFamily: "Menlo",
    marginTop: 1,
  },
  rowValue: {
    color: colors.secondaryLabel,
    fontSize: 13,
    fontFamily: "Menlo",
  },
  picker: {
    width: 36,
    height: 36,
  },
  staticSwatch: {
    width: 28,
    height: 28,
    borderRadius: 7,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.separator,
  },
  clear: {
    paddingVertical: 4,
  },
  clearText: {
    color: colors.tertiaryLabel,
    fontSize: 12,
  },
  addText: {
    color: colors.tint,
    fontSize: 15,
  },
  empty: {
    color: colors.secondaryLabel,
    fontSize: 14,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  hint: {
    color: colors.secondaryLabel,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 7,
    marginHorizontal: 5,
  },
});
