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
import * as React from "react";
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAppContext } from "./AppContext";
import { colors } from "./colors";
import { listExtensions } from "./extensionsClient";
import { DEFAULT_THEME, getApiAddress, type Theme } from "./settings";
import { SystemIcon } from "./SystemIcon";
import { useTheme } from "./theme";

/** Good default accents (between the theme swatch and the custom picker). */
const PRESETS = ["#34C759", "#30B0C7", "#007AFF", "#5856D6", "#AF52DE", "#FF2D55", "#FF9500", "#FFCC00"] as const;

const eq = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();
const isHex = (value: string): boolean => /^#[0-9a-fA-F]{6}$/.test(value);

/** A colour theme drawn from an installed extension. */
interface SelectableTheme {
  readonly key: string;
  readonly label: string;
  readonly primary: string;
  readonly secondary: string;
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

export const AppearanceScreen = (): React.ReactElement => {
  const { theme, setTheme } = useTheme();
  const { address } = useAppContext();
  const insets = useSafeAreaInsets();
  const apiBase = getApiAddress(address);

  const [themes, setThemes] = React.useState<ReadonlyArray<SelectableTheme>>([]);

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
            })),
        );
        setThemes(selectable);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [apiBase]);

  const activeTheme = themes.find((t) => eq(t.primary, theme.primary) && eq(t.secondary, theme.secondary));
  const isDefault = eq(theme.primary, DEFAULT_THEME.primary) && eq(theme.secondary, DEFAULT_THEME.secondary);
  // The picker's "Theme" anchor: the enabled theme's colours, else the default.
  const anchor: Theme = activeTheme !== undefined ? { primary: activeTheme.primary, secondary: activeTheme.secondary } : DEFAULT_THEME;

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
          <ThemeRow label="Default" primary={DEFAULT_THEME.primary} active={isDefault && activeTheme === undefined} onPress={() => setTheme(DEFAULT_THEME)} last={themes.length === 0} />
          {themes.map((t, index) => (
            <ThemeRow
              key={t.key}
              label={t.label}
              primary={t.primary}
              active={activeTheme?.key === t.key}
              onPress={() => setTheme({ primary: t.primary, secondary: t.secondary })}
              last={index === themes.length - 1}
            />
          ))}
        </View>
        {themes.length === 0 ? <Text style={styles.hint}>Install a theme from Extensions to see it here.</Text> : null}

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
