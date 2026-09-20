/**
 * Choose which values to copy out of a source theme.
 *
 * A nested list with tri-state group checkboxes. A group whose children
 * disagree shows a dash rather than picking a side, because neither "on" nor
 * "off" is true of it; "All" in the navigation bar selects everything at once.
 *
 * Import is a merge. The draft was prefilled from whatever theme was already
 * applied, so only the selected paths move and everything else survives. The
 * editor badges what arrived, which is what makes the result readable
 * afterwards.
 *
 * @internal
 */
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import * as React from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAppContext } from "./AppContext";
import { colors } from "./colors";
import { getCreatedTheme } from "./createdThemes";
import { getThemeJson } from "./extensionsClient";
import { getApiAddress } from "./settings";
import type { RootStackParamList } from "./RootNavigator";
import { SystemIcon } from "./SystemIcon";
import { markImported, useThemeDraft } from "./themeDraft";
import {
  applyImport,
  importGroupsOf,
  parseVsCodeTheme,
  selectionOf,
  toggleGroup,
  togglePath,
  type ImportGroup,
  type VsCodeTheme,
} from "./vscodeTheme";

type Props = NativeStackScreenProps<RootStackParamList, "ThemeImportValues">;

const Box = (props: { readonly state: "all" | "some" | "none" }): React.ReactElement => (
  <View style={[styles.box, props.state !== "none" && styles.boxOn]}>
    {props.state === "all" ? <Text style={styles.boxMark}>✓</Text> : null}
    {props.state === "some" ? <Text style={styles.boxMark}>–</Text> : null}
  </View>
);

export const ThemeImportValuesScreen = (props: Props): React.ReactElement => {
  const { file, label } = props.route.params;
  const insets = useSafeAreaInsets();
  const { address } = useAppContext();
  const apiBase = getApiAddress(address);
  const draft = useThemeDraft();

  const [source, setSource] = React.useState<VsCodeTheme | undefined>(undefined);
  const [error, setError] = React.useState<string | undefined>(undefined);
  const [selected, setSelected] = React.useState<ReadonlySet<string>>(new Set());
  const [expanded, setExpanded] = React.useState<ReadonlySet<string>>(new Set());

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      // `created:<id>` reads a theme this app owns; anything else is a file in
      // the server's extension store.
      if (file.startsWith("created:")) {
        const created = await getCreatedTheme(file.slice("created:".length));
        if (cancelled) return;
        if (created === undefined) setError("That theme is no longer saved on this device.");
        else setSource(created.theme);
        return;
      }
      try {
        const json = await getThemeJson(apiBase, file);
        if (cancelled) return;
        const parsed = parseVsCodeTheme(json, label);
        if (parsed === undefined) setError("That theme file could not be read.");
        else setSource(parsed);
      } catch (failure: unknown) {
        if (!cancelled) setError(failure instanceof Error ? failure.message : "Could not read that theme.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiBase, file, label]);

  const groups: ReadonlyArray<ImportGroup> = React.useMemo(
    () => (source === undefined ? [] : importGroupsOf(source)),
    [source],
  );
  const allPaths = React.useMemo(() => groups.flatMap((group) => group.items.map((item) => item.path)), [groups]);

  const runImport = (): void => {
    if (source === undefined || draft.kind !== "open") return;
    markImported(selected, applyImport(draft.theme, source, selected));
    // Pop back through the source picker to the editor. `popTo` would take
    // params with it and could rewrite the editor's `themeId`, turning an edit
    // into a new theme; popping two screens leaves them untouched.
    props.navigation.pop(2);
  };

  React.useLayoutEffect(() => {
    props.navigation.setOptions({
      title: label,
      headerRight: () => (
        <TouchableOpacity activeOpacity={0.6} onPress={() => setSelected(toggleGroup(allPaths, selected))}>
          <Text style={styles.headerAction}>{selectionOf(allPaths, selected) === "all" ? "None" : "All"}</Text>
        </TouchableOpacity>
      ),
    });
  }, [props.navigation, label, allPaths, selected]);

  if (error !== undefined) {
    return (
      <View style={styles.root}>
        <Text style={styles.errorText}>{error}</Text>
      </View>
    );
  }

  if (source === undefined) {
    return (
      <View style={styles.root}>
        <ActivityIndicator style={styles.loading} size="small" color={colors.secondaryLabel} />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <ScrollView
        style={styles.scroll}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 92 }]}
      >
        <View style={styles.card}>
          {groups.map((group, groupIndex) => {
            const paths = group.items.map((item) => item.path);
            const state = selectionOf(paths, selected);
            const open = expanded.has(group.id);
            // Collapsed groups render no children at all. A theme sets a couple
            // of hundred colours, so laying every group out eagerly would cost
            // far more than the tree is worth.
            const shown = open ? group.items : [];
            const picked = paths.filter((path) => selected.has(path)).length;
            return (
              <View key={group.id}>
                <View style={[styles.row, groupIndex > 0 && styles.rowBorder]}>
                  <TouchableOpacity
                    activeOpacity={0.6}
                    accessibilityLabel={`Select ${group.title}`}
                    onPress={() => setSelected(toggleGroup(paths, selected))}
                  >
                    <Box state={state} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.rowTap}
                    activeOpacity={0.6}
                    onPress={() => setExpanded(togglePath(group.id, expanded))}
                  >
                    <SystemIcon
                      name={open ? "chevron.down" : "chevron.right"}
                      size={11}
                      color={colors.tertiaryLabel}
                    />
                    <Text style={styles.groupTitle} numberOfLines={1}>
                      {group.title}
                    </Text>
                    <Text style={styles.count}>
                      {picked === 0 || picked === paths.length ? paths.length : `${picked} / ${paths.length}`}
                    </Text>
                  </TouchableOpacity>
                </View>
                {shown.map((item) => (
                  <TouchableOpacity
                    key={item.path}
                    style={[styles.row, styles.childRow, styles.rowBorder]}
                    activeOpacity={0.6}
                    onPress={() => setSelected(togglePath(item.path, selected))}
                  >
                    <Box state={selected.has(item.path) ? "all" : "none"} />
                    <View
                      style={[
                        styles.swatch,
                        item.swatch === undefined ? styles.swatchEmpty : { backgroundColor: item.swatch },
                      ]}
                    />
                    <Text style={styles.childLabel} numberOfLines={1}>
                      {item.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            );
          })}
        </View>
      </ScrollView>

      <View style={[styles.bar, { paddingBottom: insets.bottom + 12 }]}>
        <TouchableOpacity
          style={[styles.cta, selected.size === 0 && styles.ctaDim]}
          activeOpacity={0.6}
          disabled={selected.size === 0}
          onPress={runImport}
        >
          <Text style={styles.ctaText}>
            {selected.size === 0 ? "Select values to import" : `Import ${selected.size} values`}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 10,
  },
  headerAction: {
    color: colors.tint,
    fontSize: 17,
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
    minHeight: 44,
  },
  childRow: {
    paddingLeft: 30,
  },
  rowBorder: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.separator,
  },
  rowTap: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    minWidth: 0,
  },
  groupTitle: {
    flex: 1,
    color: colors.label,
    fontSize: 16,
  },
  childLabel: {
    flex: 1,
    color: colors.secondaryLabel,
    fontSize: 13,
    fontFamily: "Menlo",
  },
  count: {
    color: colors.tertiaryLabel,
    fontSize: 14,
  },
  box: {
    width: 22,
    height: 22,
    borderRadius: 6,
    backgroundColor: colors.fillBackground,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.separator,
    alignItems: "center",
    justifyContent: "center",
  },
  boxOn: {
    backgroundColor: colors.tint,
    borderColor: colors.tint,
  },
  boxMark: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 16,
  },
  swatch: {
    width: 18,
    height: 18,
    borderRadius: 5,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.separator,
  },
  swatchEmpty: {
    backgroundColor: colors.fillBackground,
  },
  bar: {
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.separator,
    backgroundColor: colors.cardBackground,
  },
  cta: {
    paddingVertical: 13,
    borderRadius: 12,
    backgroundColor: colors.tint,
    alignItems: "center",
  },
  ctaDim: {
    opacity: 0.4,
  },
  ctaText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "600",
  },
  loading: {
    paddingVertical: 28,
  },
  errorText: {
    color: colors.destructive,
    fontSize: 14,
    lineHeight: 19,
    padding: 24,
  },
});
