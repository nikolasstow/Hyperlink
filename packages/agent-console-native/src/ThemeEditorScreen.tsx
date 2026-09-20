/**
 * Create a VS Code colour theme, or edit one already created here.
 *
 * One screen serves both. Creating opens a draft prefilled from whatever theme
 * is currently applied, so the starting point is something that already looks
 * right rather than an empty document; opening a created theme loads it. An
 * installed theme never reaches this screen, because the extension store owns
 * those files and cannot write them back.
 *
 * Every field of the format hangs off here: `name` and `type` inline,
 * `semanticHighlighting` as a switch, and the three maps behind rows carrying
 * their real counts. Search sits at the bottom of the screen where a thumb
 * reaches it, and hides as you scroll (`BottomSearchPill`) because a theme sets
 * a couple of hundred values and browsing eight groups is slower than typing.
 *
 * @internal
 */
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import * as React from "react";
import { Alert, ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useHeaderHeight } from "@react-navigation/elements";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAppContext } from "./AppContext";
import { BottomSearchPill, useSearchPill } from "./BottomSearchPill";
import { colors } from "./colors";
import { getCreatedTheme, newThemeId, saveCreatedTheme } from "./createdThemes";
import { getApiAddress } from "./settings";
import { getThemeJson } from "./extensionsClient";
import type { RootStackParamList } from "./RootNavigator";
import { SystemIcon } from "./SystemIcon";
import { useTheme } from "./theme";
import {
  adoptSavedId,
  closeDraft,
  openDraft,
  updateDraft,
  useThemeDraft,
} from "./themeDraft";
import {
  ALL_COLOR_GROUPS,
  EMPTY_THEME,
  groupIdOf,
  humanizeKey,
  parseVsCodeTheme,
  searchTheme,
  type ThemeType,
  type VsCodeTheme,
} from "./vscodeTheme";

type Props = NativeStackScreenProps<RootStackParamList, "ThemeEditor">;

/** The two appearances a theme can declare. Typed once here rather than cast at the call site. */
const THEME_TYPES: ReadonlyArray<ThemeType> = ["light", "dark"];

const Swatch = (props: { readonly color: string | undefined }): React.ReactElement => (
  <View style={[styles.swatch, props.color === undefined ? styles.swatchEmpty : { backgroundColor: props.color }]} />
);

export const ThemeEditorScreen = (props: Props): React.ReactElement => {
  const { themeId, viewFile, viewLabel } = props.route.params;
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const { address } = useAppContext();
  const apiBase = getApiAddress(address);
  const appTheme = useTheme();
  const draft = useThemeDraft();
  const pill = useSearchPill();

  const [query, setQuery] = React.useState("");
  const [loadError, setLoadError] = React.useState<string | undefined>(undefined);
  const [saving, setSaving] = React.useState(false);

  // Open the draft once: an existing theme is loaded from storage, a new one is
  // seeded from the theme currently applied so the first screen already shows
  // something coherent rather than an empty document.
  const enabledFile = appTheme.theme.code?.file;
  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      // View Properties: an installed extension theme, opened to inspect only.
      // Its document lives in the server's store, so it is fetched and parsed,
      // then the draft is opened read-only.
      if (viewFile !== undefined) {
        try {
          const json = await getThemeJson(apiBase, viewFile);
          if (cancelled) return;
          const parsed = parseVsCodeTheme(json, viewLabel ?? "Theme");
          openDraft(undefined, parsed ?? { ...EMPTY_THEME, name: viewLabel ?? "Theme" }, true);
        } catch (error: unknown) {
          if (cancelled) return;
          setLoadError(error instanceof Error ? error.message : "Could not read this theme.");
          openDraft(undefined, { ...EMPTY_THEME, name: viewLabel ?? "Theme" }, true);
        }
        return;
      }
      if (themeId !== undefined) {
        const created = await getCreatedTheme(themeId);
        if (cancelled) return;
        if (created === undefined) {
          setLoadError("That theme is no longer saved on this device.");
          return;
        }
        openDraft(created.id, created.theme);
        return;
      }
      if (enabledFile === undefined) {
        openDraft(undefined, { ...EMPTY_THEME, name: "My Theme" });
        return;
      }
      // Prefill from the applied theme. A failure here is reported rather than
      // silently starting from blank, which would look like the prefill worked
      // and produced nothing.
      try {
        const json = await getThemeJson(apiBase, enabledFile);
        if (cancelled) return;
        const parsed = parseVsCodeTheme(json, "My Theme");
        openDraft(undefined, parsed === undefined ? { ...EMPTY_THEME, name: "My Theme" } : { ...parsed, name: "My Theme" });
      } catch (error: unknown) {
        if (cancelled) return;
        setLoadError(error instanceof Error ? error.message : "Could not read the current theme.");
        openDraft(undefined, { ...EMPTY_THEME, name: "My Theme" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [themeId, apiBase, enabledFile, viewFile, viewLabel]);

  // Leaving the editor for good ends the draft. Pushing a child screen does not
  // fire this, so the draft survives the whole flow.
  React.useEffect(() => props.navigation.addListener("beforeRemove", closeDraft), [props.navigation]);

  const theme: VsCodeTheme = draft.kind === "open" ? draft.theme : EMPTY_THEME;
  // View Properties opens an installed theme read-only; every editing control
  // below keys off this, and the draft store itself refuses writes.
  const readonly = draft.kind === "open" && draft.readonly;
  // Every group, always — each opens its full key catalog, so all fields are
  // reachable whether the theme is prefilled, imported, or cleared to scratch.
  const groups = React.useMemo(
    () =>
      ALL_COLOR_GROUPS.map((group) => {
        const keys = Object.keys(theme.colors)
          .filter((key) => groupIdOf(key) === group.id)
          .sort((a, b) => a.localeCompare(b));
        return { group, count: keys.length, sample: keys.length > 0 ? theme.colors[keys[0]] : undefined };
      }),
    [theme.colors],
  );
  const colorCount = Object.keys(theme.colors).length;
  const semanticCount = Object.keys(theme.semanticTokenColors).length;
  const results = React.useMemo(() => searchTheme(theme, query), [theme, query]);
  const searching = query.trim().length > 0;

  const clearAll = (): void => {
    Alert.alert("Clear all values?", "Empties every colour and token so you can start from scratch. All fields stay available to add.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Clear",
        style: "destructive",
        onPress: () => updateDraft((current) => ({ ...current, colors: {}, tokenColors: [], semanticTokenColors: {} })),
      },
    ]);
  };

  const save = async (): Promise<void> => {
    if (draft.kind !== "open") return;
    if (theme.name.trim().length === 0) {
      Alert.alert("Name this theme", "A theme needs a name before it can be saved.");
      return;
    }
    setSaving(true);
    const id = draft.id ?? newThemeId();
    await saveCreatedTheme(id, theme);
    adoptSavedId(id);
    setSaving(false);
    props.navigation.goBack();
  };

  // Glass icon buttons in the nav bar, no title: X to close on the left; a
  // grouped clear|import capsule and a separate save on the right.
  React.useLayoutEffect(() => {
    props.navigation.setOptions({
      headerTitle: "",
      headerBackVisible: false,
      // Transparent bar + soft scroll-edge effect → iOS renders the bar and its
      // items as Liquid Glass, matching Home.
      headerTransparent: true,
      headerStyle: { backgroundColor: "transparent" },
      headerShadowVisible: false,
      scrollEdgeEffects: { top: "soft", bottom: "soft" },
      unstable_headerLeftItems: () => [
        { type: "button", label: "Close", icon: { type: "sfSymbol", name: "xmark" }, onPress: () => props.navigation.goBack() },
      ],
      // Read-only: nothing to clear, import or save, so the right side is bare.
      unstable_headerRightItems: readonly
        ? () => []
        : () => [
            { type: "button", label: "Clear", icon: { type: "sfSymbol", name: "eraser" }, onPress: clearAll },
            { type: "button", label: "Import values", icon: { type: "sfSymbol", name: "square.and.arrow.down" }, onPress: () => props.navigation.navigate("ThemeImportSource") },
            { type: "spacing", spacing: 16 },
            { type: "button", label: "Save", icon: { type: "sfSymbol", name: "checkmark" }, variant: "prominent", disabled: saving, onPress: () => void save() },
          ],
    });
  });

  return (
    <View style={styles.root}>
      <ScrollView
        style={styles.scroll}
        contentInsetAdjustmentBehavior="never"
        contentContainerStyle={[styles.content, { paddingTop: headerHeight + 8, paddingBottom: pill.listPaddingBottom + insets.bottom }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        onScroll={pill.onScroll}
        scrollEventThrottle={16}
      >
        {loadError === undefined ? null : <Text style={styles.errorText}>{loadError}</Text>}

        {searching ? (
          <>
            <Text style={styles.sectionLabel}>Colors · {results.colors.length}</Text>
            <View style={styles.card}>
              {results.colors.length === 0 ? (
                <Text style={styles.empty}>No colours match “{query.trim()}”.</Text>
              ) : (
                results.colors.slice(0, 40).map((hit, index) => (
                  <TouchableOpacity
                    key={hit.key}
                    style={[styles.row, index > 0 && styles.rowBorder]}
                    activeOpacity={0.6}
                    onPress={() => props.navigation.navigate("ThemeColorGroup", { groupId: "search", focusKey: hit.key })}
                  >
                    <Swatch color={hit.value} />
                    <Text style={styles.rowTitle} numberOfLines={1}>
                      {hit.label}
                    </Text>
                    <Text style={styles.rowValue}>{hit.value}</Text>
                  </TouchableOpacity>
                ))
              )}
            </View>

            <Text style={styles.sectionLabel}>Token scopes · {results.tokens.length}</Text>
            <View style={styles.card}>
              {results.tokens.length === 0 ? (
                <Text style={styles.empty}>No scopes match “{query.trim()}”.</Text>
              ) : (
                results.tokens.slice(0, 40).map((hit, index) => (
                  <TouchableOpacity
                    key={`${hit.index}:${hit.scope}`}
                    style={[styles.row, index > 0 && styles.rowBorder]}
                    activeOpacity={0.6}
                    onPress={() => props.navigation.navigate("ThemeTokenRule", { index: hit.index })}
                  >
                    <Swatch color={hit.foreground} />
                    <Text style={styles.rowMono} numberOfLines={1}>
                      {hit.scope}
                    </Text>
                    <SystemIcon name="chevron.right" size={13} color={colors.tertiaryLabel} />
                  </TouchableOpacity>
                ))
              )}
            </View>
          </>
        ) : (
          <>
            <View style={styles.card}>
              <View style={styles.row}>
                <Text style={styles.rowTitle}>Name</Text>
                <TextInput
                  style={styles.input}
                  value={theme.name}
                  editable={!readonly}
                  onChangeText={(name) => updateDraft((current) => ({ ...current, name }))}
                  placeholder="My Theme"
                  placeholderTextColor={colors.placeholderText}
                  autoCapitalize="words"
                  autoCorrect={false}
                />
              </View>
              <View style={[styles.row, styles.rowBorder]}>
                <Text style={styles.rowTitle}>Type</Text>
                {THEME_TYPES.map((type) => (
                  <TouchableOpacity
                    key={type}
                    style={[styles.segment, theme.type === type && styles.segmentOn]}
                    activeOpacity={0.6}
                    disabled={readonly}
                    onPress={() => updateDraft((current) => ({ ...current, type }))}
                  >
                    <Text style={[styles.segmentText, theme.type === type && styles.segmentTextOn]}>
                      {type === "light" ? "Light" : "Dark"}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              <View style={[styles.row, styles.rowBorder]}>
                <Text style={styles.rowTitle}>Semantic highlighting</Text>
                <Switch
                  value={theme.semanticHighlighting}
                  disabled={readonly}
                  onValueChange={(semanticHighlighting) => updateDraft((current) => ({ ...current, semanticHighlighting }))}
                />
              </View>
            </View>
            <Text style={styles.hint}>Which appearance this theme is written for. Type decides where it is offered.</Text>

            <Text style={styles.sectionLabel}>Colors · {colorCount} set</Text>
            <View style={styles.card}>
              {groups.map((summary, index) => (
                <TouchableOpacity
                  key={summary.group.id}
                  style={[styles.row, index > 0 && styles.rowBorder]}
                  activeOpacity={0.6}
                  onPress={() => props.navigation.navigate("ThemeColorGroup", { groupId: summary.group.id })}
                >
                  <Swatch color={summary.sample} />
                  <Text style={styles.rowTitle} numberOfLines={1}>
                    {summary.group.title}
                  </Text>
                  <Text style={styles.rowValue}>{summary.count}</Text>
                  <SystemIcon name="chevron.right" size={13} color={colors.tertiaryLabel} />
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.sectionLabel}>Syntax</Text>
            <View style={styles.card}>
              <TouchableOpacity
                style={styles.row}
                activeOpacity={0.6}
                onPress={() => props.navigation.navigate("ThemeTokens")}
              >
                <Text style={styles.rowTitle}>Token colors</Text>
                <Text style={styles.rowValue}>{theme.tokenColors.length}</Text>
                <SystemIcon name="chevron.right" size={13} color={colors.tertiaryLabel} />
              </TouchableOpacity>
              <View style={[styles.row, styles.rowBorder]}>
                <Text style={styles.rowTitle}>Semantic tokens</Text>
                <Text style={styles.rowValue}>{semanticCount}</Text>
              </View>
            </View>
            {semanticCount === 0 ? null : (
              <Text style={styles.hint}>
                {Object.keys(theme.semanticTokenColors)
                  .slice(0, 3)
                  .map((key) => humanizeKey(key))
                  .join(", ")}
                {semanticCount > 3 ? ` and ${semanticCount - 3} more` : ""}
              </Text>
            )}
          </>
        )}
      </ScrollView>

      <BottomSearchPill
        value={query}
        onChangeText={setQuery}
        placeholder={`Search ${colorCount + theme.tokenColors.length} values`}
        offset={pill.offset}
      />
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
    paddingTop: 4,
  },
  headerAction: {
    color: colors.tint,
    fontSize: 17,
    fontWeight: "600",
  },
  headerActionDim: {
    opacity: 0.4,
  },
  sectionLabel: {
    color: colors.secondaryLabel,
    fontSize: 13,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginTop: 24,
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
  cardSpaced: {
    marginTop: 12,
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
  rowTitle: {
    flex: 1,
    color: colors.label,
    fontSize: 16,
  },
  rowAction: {
    flex: 1,
    color: colors.tint,
    fontSize: 16,
  },
  clearAction: {
    color: colors.destructive,
  },
  rowMono: {
    flex: 1,
    color: colors.label,
    fontSize: 14,
    fontFamily: "Menlo",
  },
  rowValue: {
    color: colors.secondaryLabel,
    fontSize: 14,
    fontFamily: "Menlo",
  },
  input: {
    flex: 1,
    color: colors.label,
    fontSize: 16,
    textAlign: "right",
    padding: 0,
  },
  segment: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: colors.fillBackground,
  },
  segmentOn: {
    backgroundColor: colors.accentTint,
  },
  segmentText: {
    color: colors.secondaryLabel,
    fontSize: 14,
    fontWeight: "500",
  },
  segmentTextOn: {
    color: colors.tint,
    fontWeight: "600",
  },
  swatch: {
    width: 26,
    height: 26,
    borderRadius: 7,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.separator,
  },
  swatchEmpty: {
    backgroundColor: colors.fillBackground,
  },
  hint: {
    color: colors.secondaryLabel,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 7,
    marginHorizontal: 5,
  },
  empty: {
    color: colors.secondaryLabel,
    fontSize: 14,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  errorText: {
    color: colors.destructive,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 10,
    marginHorizontal: 5,
  },
});
