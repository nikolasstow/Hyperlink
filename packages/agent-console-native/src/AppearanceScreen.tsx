/**
 * Appearance — pick the app's theme and accent colours. Separate from
 * Extensions: you *install* themes there (marketplace / import), and *enable*
 * them here. Installed colour themes show up as selectable options; each
 * carries the primary/secondary the server derived from it.
 *
 * The two colour pickers follow one layout: the first swatch is the enabled
 * theme's colour (default or a selected theme), the last is a custom colour,
 * and good presets sit in between. The selected value is ringed.
 *
 * @internal
 */
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { ThemeRegistrationRaw } from "shiki/core";
import * as React from "react";
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, useColorScheme, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAppContext } from "./AppContext";
import { CodeBlock } from "./CodeBlock";
import { colors } from "./colors";
import { getThemeJson, listExtensions } from "./extensionsClient";
import { getCustomFonts, type CustomFont } from "./fontsClient";
import type { RootStackParamList } from "./RootNavigator";
import { DEFAULT_THEME, getApiAddress, type Theme } from "./settings";
import { FALLBACK_THEME } from "./shikiHighlighter";
import { SystemIcon } from "./SystemIcon";
import { useTheme } from "./theme";
import { listCreatedThemes, type CreatedTheme } from "./createdThemes";

type Props = NativeStackScreenProps<RootStackParamList, "Appearance">;

/** Sample snippet for the code-highlighting preview. */
const PREVIEW_CODE = `import { Effect } from "effect"

// A tiny program: fetch a user, greet them.
const greet = (id: number) =>
  Effect.gen(function* () {
    const user = yield* findUser(id)
    return \`Hello, \${user.name}!\`
  })
`;

/** Good default accents (between the theme swatch and the custom picker). */
const PRESETS = ["#34C759", "#30B0C7", "#007AFF", "#5856D6", "#AF52DE", "#FF2D55", "#FF9500", "#FFCC00"] as const;

/** Monospace fonts guaranteed present on iOS. Bundled coding fonts (JetBrains
 * Mono, etc.) and custom uploads come later (need expo-font + a build). */
const CODE_FONTS = ["Menlo", "Courier New", "Courier"];

const eq = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();
const isHex = (value: string): boolean => /^#[0-9a-fA-F]{6}$/.test(value);

/** A colour theme drawn from an installed extension. */
interface SelectableTheme {
  readonly key: string;
  readonly label: string;
  readonly primary: string;
  readonly secondary: string;
  /** Store-relative theme file, to fetch its full JSON for code highlighting. */
  readonly file: string;
}

const ColorSwatches = (props: {
  readonly value: string;
  /** The enabled theme's colour for this role — the first ("Theme") swatch. */
  readonly themeColor: string;
  readonly onChange: (color: string) => void;
}): React.ReactElement => {
  const [customOpen, setCustomOpen] = React.useState(false);
  const [draft, setDraft] = React.useState(props.value);

  const isTheme = eq(props.value, props.themeColor);
  const isPreset = PRESETS.some((c) => eq(c, props.value));
  const isCustom = !isTheme && !isPreset;

  return (
    <View style={styles.swatchArea}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.swatchRow}>
        <TouchableOpacity
          accessibilityLabel="Theme colour"
          onPress={() => props.onChange(props.themeColor)}
          style={[styles.swatch, { backgroundColor: props.themeColor }, isTheme ? styles.swatchSelected : null]}
        >
          <SystemIcon name="paintpalette.fill" size={12} color="#FFFFFF" />
        </TouchableOpacity>
        {PRESETS.map((color) => (
          <TouchableOpacity
            key={color}
            accessibilityLabel={color}
            onPress={() => props.onChange(color)}
            style={[styles.swatch, { backgroundColor: color }, eq(color, props.value) ? styles.swatchSelected : null]}
          />
        ))}
        <TouchableOpacity
          accessibilityLabel="Custom colour"
          onPress={() => {
            setDraft(isCustom ? props.value : "#");
            setCustomOpen((open) => !open);
          }}
          style={[styles.swatch, styles.customSwatch, isCustom ? [styles.swatchSelected, { backgroundColor: props.value }] : null]}
        >
          <SystemIcon name="eyedropper" size={12} color={isCustom ? "#FFFFFF" : colors.secondaryLabel} />
        </TouchableOpacity>
      </ScrollView>
      {customOpen ? (
        <TextInput
          style={styles.hexInput}
          value={draft}
          onChangeText={(text) => {
            const next = text.startsWith("#") ? text : `#${text}`;
            setDraft(next);
            if (isHex(next)) props.onChange(next.toUpperCase());
          }}
          autoCapitalize="characters"
          autoCorrect={false}
          placeholder="#RRGGBB"
          placeholderTextColor={colors.placeholderText}
          maxLength={7}
        />
      ) : null}
    </View>
  );
};

export const AppearanceScreen = (props: Props): React.ReactElement => {
  const { theme, setTheme } = useTheme();
  const { address } = useAppContext();
  const insets = useSafeAreaInsets();
  const apiBase = getApiAddress(address);

  const [themes, setThemes] = React.useState<ReadonlyArray<SelectableTheme>>([]);
  // Themes made on this device. They sit beside the installed ones but, unlike
  // those, can be opened and edited — an installed theme is a file in the
  // server's extension store and is not ours to rewrite.
  const [created, setCreated] = React.useState<ReadonlyArray<CreatedTheme>>([]);
  const [customFonts, setCustomFonts] = React.useState<ReadonlyArray<CustomFont>>([]);

  React.useEffect(() => {
    let cancelled = false;
    getCustomFonts(apiBase)
      .then((list) => {
        if (!cancelled) setCustomFonts(list);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [apiBase]);

  React.useEffect(() => {
    let cancelled = false;
    listExtensions(apiBase)
      .then((list) => {
        if (cancelled) return;
        const selectable = list.flatMap((ext) =>
          ext.colorThemes
            .filter((ct) => ct.colors !== undefined)
            .map((ct) => ({
              key: `${ext.id}:${ct.id}`,
              label: ct.label,
              primary: ct.colors?.primary ?? DEFAULT_THEME.primary,
              secondary: ct.colors?.secondary ?? DEFAULT_THEME.secondary,
              file: ct.file,
            })),
        );
        setThemes(selectable);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [apiBase]);

  React.useEffect(
    () => props.navigation.addListener("focus", () => void listCreatedThemes().then(setCreated)),
    [props.navigation],
  );

  // The enabled code theme is tracked independently of the accents, so changing
  // a colour never unsets it. Its accents are the picker's "Theme" anchor.
  const enabled = theme.code;
  const anchor: Theme = enabled !== undefined ? { primary: enabled.primary, secondary: enabled.secondary, codeFont: theme.codeFont } : DEFAULT_THEME;

  // Selecting a theme seeds the accents AND records it as the code theme;
  // changing colours afterwards leaves `code` intact.
  const selectTheme = (t: SelectableTheme): void =>
    setTheme({ ...theme, primary: t.primary, secondary: t.secondary, code: { label: t.label, file: t.file, primary: t.primary, secondary: t.secondary } });
  const selectDefault = (): void => setTheme({ ...theme, primary: DEFAULT_THEME.primary, secondary: DEFAULT_THEME.secondary, code: undefined });

  // The code preview uses the enabled theme's real tokenColors (fetched from the
  // server), else a bundled theme matching the scheme.
  const scheme = useColorScheme();
  const [previewTheme, setPreviewTheme] = React.useState<string | ThemeRegistrationRaw>(
    scheme === "dark" ? FALLBACK_THEME.dark : FALLBACK_THEME.light,
  );
  React.useEffect(() => {
    let cancelled = false;
    if (enabled === undefined) {
      setPreviewTheme(scheme === "dark" ? FALLBACK_THEME.dark : FALLBACK_THEME.light);
      return;
    }
    getThemeJson(apiBase, enabled.file)
      .then((json) => {
        if (!cancelled) setPreviewTheme({ ...json, name: enabled.file });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [apiBase, enabled?.file, scheme]); // eslint-disable-line react-hooks/exhaustive-deps -- keyed by theme file

  return (
    <ScrollView
      style={styles.root}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
    >
        <Text style={styles.sectionLabel}>Theme</Text>
        <View style={styles.card}>
          <ThemeRow label="Default" primary={DEFAULT_THEME.primary} active={enabled === undefined} onPress={selectDefault} last={themes.length === 0} />
          {themes.map((t, index) => (
            <ThemeRow
              key={t.key}
              label={t.label}
              primary={t.primary}
              active={enabled?.file === t.file}
              onPress={() => selectTheme(t)}
              last={index === themes.length - 1}
            />
          ))}
        </View>
        {themes.length === 0 ? <Text style={styles.hint}>Install a theme from Extensions to see it here.</Text> : null}

        <Text style={styles.sectionLabel}>Your themes</Text>
        <View style={styles.card}>
          {created.map((mine) => (
            <TouchableOpacity
              key={mine.id}
              onPress={() => props.navigation.navigate("ThemeEditor", { themeId: mine.id })}
              activeOpacity={0.6}
            >
              <View style={styles.themeRow}>
                <View
                  style={[
                    styles.themeDot,
                    { backgroundColor: mine.theme.colors["editor.background"] ?? DEFAULT_THEME.primary },
                  ]}
                />
                <Text style={styles.themeLabel} numberOfLines={1}>
                  {mine.theme.name}
                </Text>
                <SystemIcon name="chevron.right" size={14} color={colors.secondaryLabel} />
              </View>
            </TouchableOpacity>
          ))}
          <TouchableOpacity onPress={() => props.navigation.navigate("ThemeEditor", {})} activeOpacity={0.6}>
            <View style={[styles.themeRow, created.length > 0 && styles.rowSeparator]}>
              <Text style={styles.addFontLabel}>Create theme…</Text>
            </View>
          </TouchableOpacity>
        </View>
        <Text style={styles.hint}>Installed themes can’t be edited. Create one to make changes.</Text>

        <Text style={styles.sectionLabel}>Primary color</Text>
        <View style={styles.card}>
          <Text style={styles.hint}>The send button, and the shade of your chat bubbles.</Text>
          <ColorSwatches value={theme.primary} themeColor={anchor.primary} onChange={(color) => setTheme({ ...theme, primary: color })} />
        </View>

        <Text style={styles.sectionLabel}>Secondary color</Text>
        <View style={styles.card}>
          <Text style={styles.hint}>Accents like the unread indicator.</Text>
          <ColorSwatches value={theme.secondary} themeColor={anchor.secondary} onChange={(color) => setTheme({ ...theme, secondary: color })} />
        </View>

        <Text style={styles.sectionLabel}>Code font</Text>
        <View style={styles.card}>
          {[...CODE_FONTS, ...customFonts.map((f) => f.family)].map((font) => (
            <TouchableOpacity key={font} onPress={() => setTheme({ ...theme, codeFont: font })} activeOpacity={0.6}>
              <View style={styles.themeRow}>
                <Text style={[styles.fontSample, { fontFamily: font }]}>Ag</Text>
                <Text style={styles.themeLabel} numberOfLines={1}>
                  {font}
                </Text>
                {theme.codeFont === font ? <SystemIcon name="checkmark" size={15} color={colors.tint} /> : null}
              </View>
              <View style={styles.rowSeparator} />
            </TouchableOpacity>
          ))}
          {/* Add-font entry at the bottom of the list. */}
          <TouchableOpacity onPress={() => props.navigation.navigate("FontImport")} activeOpacity={0.6}>
            <View style={styles.themeRow}>
              <SystemIcon name="plus" size={16} color={colors.tint} />
              <Text style={[styles.themeLabel, styles.addFontLabel]} numberOfLines={1}>
                Add font…
              </Text>
              <SystemIcon name="chevron.right" size={15} color={colors.secondaryLabel} />
            </View>
          </TouchableOpacity>
        </View>

        <Text style={styles.sectionLabel}>Preview</Text>
        <View style={styles.card}>
          <Text style={styles.hint}>How code looks with the enabled theme and font.</Text>
          <CodeBlock code={PREVIEW_CODE} lang="typescript" theme={previewTheme} fontFamily={theme.codeFont} />
        </View>
    </ScrollView>
  );
};

const ThemeRow = (props: {
  readonly label: string;
  readonly primary: string;
  readonly active: boolean;
  readonly onPress: () => void;
  readonly last: boolean;
}): React.ReactElement => (
  <TouchableOpacity onPress={props.onPress} activeOpacity={0.6}>
    <View style={styles.themeRow}>
      <View style={[styles.themeDot, { backgroundColor: props.primary }]} />
      <Text style={styles.themeLabel} numberOfLines={1}>
        {props.label}
      </Text>
      {props.active ? <SystemIcon name="checkmark" size={15} color={colors.tint} /> : null}
    </View>
    {props.last ? null : <View style={styles.rowSeparator} />}
  </TouchableOpacity>
);

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
  },
  sectionLabel: {
    color: colors.secondaryLabel,
    fontSize: 13,
    textTransform: "uppercase",
    marginTop: 16,
    marginBottom: 6,
    marginLeft: 4,
  },
  card: {
    backgroundColor: colors.cardBackground,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.separator,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 8,
  },
  hint: {
    color: colors.secondaryLabel,
    fontSize: 13,
  },
  themeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 10,
  },
  themeDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.separator,
  },
  themeLabel: {
    flex: 1,
    color: colors.label,
    fontSize: 16,
  },
  fontSample: {
    width: 30,
    fontSize: 17,
    color: colors.label,
  },
  addFontLabel: {
    color: colors.tint,
  },
  rowSeparator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.separator,
  },
  swatchArea: {
    gap: 12,
    paddingTop: 4,
  },
  swatchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingRight: 4,
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
    borderColor: colors.label,
  },
  customSwatch: {
    backgroundColor: colors.fillBackground,
  },
  hexInput: {
    color: colors.label,
    fontSize: 16,
    fontFamily: "Menlo",
    paddingVertical: 8,
    paddingHorizontal: 10,
    backgroundColor: colors.fillBackground,
    borderRadius: 8,
  },
});
