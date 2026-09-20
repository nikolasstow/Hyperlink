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
  EMPTY_THEME,
  humanizeKey,
  parseVsCodeTheme,
  searchTheme,
  summarizeColorGroups,
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
  const { themeId, sourceFile, sourceName } = props.route.params;
  const insets = useSafeAreaInsets();
  const { address } = useAppContext();
  const apiBase = getApiAddress(address);
  const appTheme = useTheme();
  const draft = useThemeDraft();
  const pill = useSearchPill();

  const [query, setQuery] = React.useState("");
  const [loadError, setLoadError] = React.useState<string | undefined>(undefined);
  const [saving, setSaving] = React.useState(false);

  // Open the draft once: an existing theme is loaded from storage, a new one is
  // seeded from a theme already installed so the first screen shows something
  // coherent rather than an empty document. That source is the theme currently
  // applied, unless a duplicate named one.
  const source = sourceFile ?? appTheme.theme.code?.file;
  const newName = sourceName === undefined ? "My Theme" : `${sourceName} copy`;
  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
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
      if (source === undefined) {
        openDraft(undefined, { ...EMPTY_THEME, name: newName });
        return;
      }
      // Prefill from the applied theme. A failure here is reported rather than
      // silently starting from blank, which would look like the prefill worked
      // and produced nothing.
      try {
        const json = await getThemeJson(apiBase, source);
        if (cancelled) return;
        const parsed = parseVsCodeTheme(json, newName);
        openDraft(undefined, parsed === undefined ? { ...EMPTY_THEME, name: newName } : { ...parsed, name: newName });
      } catch (error: unknown) {
        if (cancelled) return;
        setLoadError(error instanceof Error ? error.message : "Could not read that theme.");
        openDraft(undefined, { ...EMPTY_THEME, name: newName });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [themeId, apiBase, source, newName]);

  // Leaving the editor for good ends the draft. Pushing a child screen does not
  // fire this, so the draft survives the whole flow.
  React.useEffect(() => props.navigation.addListener("beforeRemove", closeDraft), [props.navigation]);

  const theme: VsCodeTheme = draft.kind === "open" ? draft.theme : EMPTY_THEME;
  const groups = React.useMemo(() => summarizeColorGroups(theme.colors), [theme.colors]);
  const colorCount = Object.keys(theme.colors).length;
  const semanticCount = Object.keys(theme.semanticTokenColors).length;
  const results = React.useMemo(() => searchTheme(theme, query), [theme, query]);
  const searching = query.trim().length > 0;

  const save = async (): Promise<void> => {
    if (draft.kind !== "open") return;
    if (theme.name.trim().length === 0) {
      Alert.alert("Name this theme", "A theme needs a name before it can be saved.");
      return;
    }
    setSaving(true);
    const id = draft.id ?? newThemeId();
    try {
      await saveCreatedTheme(id, theme);
    } catch (error: unknown) {
      setSaving(false);
      // Storage can refuse a write, and a Save button that closed the screen
      // anyway would look like it had worked.
      Alert.alert("Could not save", error instanceof Error ? error.message : "The theme was not written to this device.");
      return;
    }
    adoptSavedId(id);
    setSaving(false);
    props.navigation.goBack();
  };

  React.useLayoutEffect(() => {
    props.navigation.setOptions({
      title: themeId === undefined ? "New Theme" : "Edit Theme",
      headerRight: () => (
        <TouchableOpacity onPress={() => void save()} disabled={saving} activeOpacity={0.6}>
          <Text style={[styles.headerAction, saving && styles.headerActionDim]}>Save</Text>
        </TouchableOpacity>
      ),
    });
  });

  return (
    <View style={styles.root}>
      <ScrollView
        style={styles.scroll}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={[styles.content, { paddingBottom: pill.listPaddingBottom + insets.bottom }]}
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
                    <Text style={styles.rowValue}>{hit.value ?? "Not set"}</Text>
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
                  onValueChange={(semanticHighlighting) => updateDraft((current) => ({ ...current, semanticHighlighting }))}
                />
              </View>
            </View>
            <Text style={styles.hint}>Which appearance this theme is written for. Type decides where it is offered.</Text>

            <View style={[styles.card, styles.cardSpaced]}>
              <TouchableOpacity
                style={styles.row}
                activeOpacity={0.6}
                onPress={() => props.navigation.navigate("ThemeImportSource")}
              >
                <Text style={styles.rowAction}>Import values from a theme…</Text>
                <SystemIcon name="chevron.right" size={13} color={colors.tertiaryLabel} />
              </TouchableOpacity>
            </View>

            <Text style={styles.sectionLabel}>Colors · {colorCount} set</Text>
            <View style={styles.card}>
              {groups.length === 0 ? (
                <Text style={styles.empty}>No colours set yet. Import some, or search for a key to add one.</Text>
              ) : (
                groups.map((summary, index) => (
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
                    <Text style={styles.rowValue}>{summary.keys.length}</Text>
                    <SystemIcon name="chevron.right" size={13} color={colors.tertiaryLabel} />
                  </TouchableOpacity>
                ))
              )}
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
