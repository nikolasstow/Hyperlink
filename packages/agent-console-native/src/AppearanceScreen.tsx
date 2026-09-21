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
import * as React from "react";
import { Alert, ScrollView, Share, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from "react-native";
import { File, Paths } from "expo-file-system";
import { Button, Circle, ColorPicker, ContextMenu, Host, HStack, Image, Section, Spacer, Text as UIText, VStack } from "@expo/ui/swift-ui";
import { background, cornerRadius, font, foregroundStyle, frame, lineLimit, onTapGesture, padding } from "@expo/ui/swift-ui/modifiers";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAppContext } from "./AppContext";
import { CodeBlock } from "./CodeBlock";
import { colors } from "./colors";
import { getThemeJson, listExtensions, removeExtension } from "./extensionsClient";
import { getCustomFonts, type CustomFont } from "./fontsClient";
import type { RootStackParamList } from "./RootNavigator";
import { DEFAULT_THEME, getApiAddress, type CodeTheme } from "./settings";
import { SystemIcon } from "./SystemIcon";
import { useTheme } from "./theme";
import { useCodeTheme } from "./useCodeTheme";
import {
  deleteCreatedTheme,
  listCreatedThemes,
  newThemeId,
  saveCreatedTheme,
  type CreatedTheme,
} from "./createdThemes";
import { deriveThemeAccents, parseVsCodeTheme, toOpaqueHex, toThemeDocument, type VsCodeTheme } from "./vscodeTheme";

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
  /** The extension this theme belongs to — its id removes it, its name labels
   * the "Uninstall Extension …" action. */
  readonly extId: string;
  readonly extName: string;
}

/** Swatch geometry, used to fit exactly one row with no scroll. */
const SWATCH = 32;
const SWATCH_GAP = 12;
/** Horizontal chrome to subtract: screen content padding (16) + card padding
 * (14), both sides. */
const ROW_CHROME = (16 + 14) * 2;

const ColorSwatches = (props: {
  readonly value: string;
  /** The enabled theme's colour for this role — the first ("Theme") swatch. */
  readonly themeColor: string;
  readonly onChange: (color: string) => void;
}): React.ReactElement => {
  const { width } = useWindowDimensions();
  // How many swatches fit in one row; reserve the theme swatch + the picker,
  // and show only that many presets so the row never scrolls.
  const available = width - ROW_CHROME;
  const maxSwatches = Math.max(2, Math.floor((available + SWATCH_GAP) / (SWATCH + SWATCH_GAP)));
  const presets = PRESETS.slice(0, Math.max(0, maxSwatches - 2));

  // Centred row with a fixed gap — tight and evenly spaced, not stretched. The
  // picker Host hugs its well (matchContents) so its gap matches the swatches'.
  return (
    <View style={styles.swatchRow}>
      <TouchableOpacity
        accessibilityLabel="Theme colour"
        onPress={() => props.onChange(props.themeColor)}
        style={[styles.swatch, { backgroundColor: props.themeColor }, eq(props.value, props.themeColor) ? styles.swatchSelected : null]}
      >
        <SystemIcon name="paintpalette.fill" size={12} color="#FFFFFF" />
      </TouchableOpacity>
      {presets.map((color) => (
        <TouchableOpacity
          key={color}
          accessibilityLabel={color}
          onPress={() => props.onChange(color)}
          style={[styles.swatch, { backgroundColor: color }, eq(color, props.value) ? styles.swatchSelected : null]}
        />
      ))}
      {/* Custom colour — Apple's native picker (Grid/Spectrum/Sliders, hex,
       * eyedropper, favourites); its well shows the current value. */}
      <Host style={styles.pickerSwatch} matchContents>
        <ColorPicker
          label=""
          selection={props.value}
          onSelectionChange={(next) => {
            const hex = next.length >= 7 ? next.slice(0, 7) : next;
            if (isHex(hex)) props.onChange(hex.toUpperCase());
          }}
        />
      </Host>
    </View>
  );
};

export const AppearanceScreen = (props: Props): React.ReactElement => {
  const { theme, setTheme } = useTheme();
  const { address } = useAppContext();
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  // The theme list is a SwiftUI card that sizes to an explicit width; the screen
  // content is padded 16 each side, so the card spans the rest.
  const contentWidth = windowWidth - 32;
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

  // Best-effort: a settings screen must render whether or not the extension
  // server is reachable, so a failed list leaves the previous one in place.
  const refreshThemes = React.useCallback(async (): Promise<void> => {
    const list = await listExtensions(apiBase).catch(() => undefined);
    if (list === undefined) return;
    setThemes(
      list.flatMap((ext) =>
        ext.colorThemes
          .filter((ct) => ct.colors !== undefined)
          .map((ct) => ({
            key: `${ext.id}:${ct.id}`,
            label: ct.label,
            primary: ct.colors?.primary ?? DEFAULT_THEME.primary,
            secondary: ct.colors?.secondary ?? DEFAULT_THEME.secondary,
            file: ct.file,
            extId: ext.id,
            extName: ext.displayName,
          })),
      ),
    );
  }, [apiBase]);

  const refreshCreated = React.useCallback((): void => {
    void listCreatedThemes().then(setCreated);
  }, []);

  React.useEffect(() => {
    void refreshThemes();
  }, [refreshThemes]);

  // Reloading created themes on focus catches edits made in the editor and
  // duplicates created from the context menu.
  React.useEffect(() => props.navigation.addListener("focus", refreshCreated), [props.navigation, refreshCreated]);

  // The enabled code theme is tracked independently of the accents, so changing
  // a colour never unsets it. Its accents are the picker's "Theme" anchor.
  const enabled = theme.code;
  const anchor = enabled !== undefined ? { primary: enabled.primary, secondary: enabled.secondary, codeFont: theme.codeFont } : DEFAULT_THEME;

  // Selecting a theme seeds the accents AND records it as the code theme;
  // changing colours afterwards leaves `code` intact.
  const selectTheme = (t: SelectableTheme): void =>
    setTheme({ ...theme, primary: t.primary, secondary: t.secondary, code: { label: t.label, file: t.file, primary: t.primary, secondary: t.secondary } });

  // A created theme has no server file, so its accents come from its own colours
  // and it is recorded by `createdId`; the preview reads it from local storage.
  const selectCreated = (mine: CreatedTheme): void => {
    const { primary, secondary } = deriveThemeAccents(mine.theme, DEFAULT_THEME);
    setTheme({ ...theme, primary, secondary, code: { label: mine.theme.name, file: "", primary, secondary, createdId: mine.id } });
  };

  const selectDefault = (): void => setTheme({ ...theme, primary: DEFAULT_THEME.primary, secondary: DEFAULT_THEME.secondary, code: undefined });

  /* --- The long-press menu on each theme ---------------------------------- */

  const editCreated = (mine: CreatedTheme): void => props.navigation.navigate("ThemeEditor", { themeId: mine.id });
  const viewExtension = (t: SelectableTheme): void => props.navigation.navigate("ThemeEditor", { viewFile: t.file, viewLabel: t.label });

  /** `Base copy`, then `Base copy 2`, `Base copy 3`, … — the first free name. */
  const copyName = (base: string): string => {
    const taken = new Set(created.map((c) => c.theme.name));
    let name = `${base} copy`;
    let n = 1;
    while (taken.has(name)) {
      n += 1;
      name = `${base} copy ${n}`;
    }
    return name;
  };

  const duplicateFrom = async (source: VsCodeTheme): Promise<void> => {
    const id = newThemeId();
    await saveCreatedTheme(id, { ...source, name: copyName(source.name) });
    refreshCreated();
    props.navigation.navigate("ThemeEditor", { themeId: id });
  };

  /** An installed theme's full document lives on the server; fetch and parse it
   * before duplicating or exporting. A failure surfaces rather than no-ops. */
  const loadExtensionTheme = async (t: SelectableTheme): Promise<VsCodeTheme | undefined> => {
    try {
      const parsed = parseVsCodeTheme(await getThemeJson(apiBase, t.file), t.label);
      if (parsed === undefined) throw new Error("The theme file could not be read.");
      return parsed;
    } catch (error: unknown) {
      Alert.alert("Couldn’t read theme", error instanceof Error ? error.message : "Unknown error.");
      return undefined;
    }
  };

  const duplicateCreated = (mine: CreatedTheme): void => void duplicateFrom(mine.theme);
  const duplicateExtension = (t: SelectableTheme): void =>
    void loadExtensionTheme(t).then((source) => (source === undefined ? undefined : duplicateFrom(source)));

  // Written as a real <name>.json file (the VS Code theme document) in the cache
  // directory, then handed to the share sheet as a file URL — so "Save to
  // Files", AirDrop, Mail, etc. carry out an actual file that drops into any VS
  // Code-based IDE, not a blob of text.
  const exportTheme = (source: VsCodeTheme): void => {
    void (async () => {
      const json = JSON.stringify(toThemeDocument(source), null, 2);
      // Strip only the characters a filename cannot contain; keep spaces/case.
      const safe = source.name.replace(/[/\\:*?"<>|]/g, "").trim() || "theme";
      try {
        const file = new File(Paths.cache, `${safe}.json`);
        file.create({ overwrite: true });
        file.write(json);
        await Share.share({ url: file.uri });
      } catch (error: unknown) {
        Alert.alert("Couldn’t export theme", error instanceof Error ? error.message : "Unknown error.");
      }
    })();
  };
  const exportCreated = (mine: CreatedTheme): void => exportTheme(mine.theme);
  const exportExtension = (t: SelectableTheme): void =>
    void loadExtensionTheme(t).then((source) => (source === undefined ? undefined : exportTheme(source)));

  const deleteCreated = (mine: CreatedTheme): void => {
    Alert.alert(`Delete “${mine.theme.name}”?`, "Removes this theme from the device. This can’t be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () =>
          void (async () => {
            await deleteCreatedTheme(mine.id);
            if (enabled?.createdId === mine.id) selectDefault();
            refreshCreated();
          })(),
      },
    ]);
  };

  const uninstallExtension = (t: SelectableTheme): void => {
    Alert.alert(`Uninstall ${t.extName}?`, "Removes the extension and every theme it provides.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Uninstall",
        style: "destructive",
        onPress: () =>
          void (async () => {
            try {
              await removeExtension(apiBase, t.extId);
            } catch (error: unknown) {
              Alert.alert("Couldn’t uninstall", error instanceof Error ? error.message : "Unknown error.");
              return;
            }
            if (enabled?.createdId === undefined && enabled?.file === t.file) selectDefault();
            await refreshThemes();
          })(),
      },
    ]);
  };

  // The code preview highlights with the enabled theme (installed, created, or a
  // bundled fallback) — resolved by the same hook the file viewer uses.
  const previewTheme = useCodeTheme();

  return (
    <ScrollView
      style={styles.root}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
    >
        <Text style={styles.sectionLabel}>Theme</Text>
        <ThemeList
          contentWidth={contentWidth}
          themes={themes}
          created={created}
          enabled={enabled}
          onSelectDefault={selectDefault}
          onSelectExtension={selectTheme}
          onSelectCreated={selectCreated}
          onView={viewExtension}
          onEdit={editCreated}
          onDuplicateExtension={duplicateExtension}
          onDuplicateCreated={duplicateCreated}
          onExportExtension={exportExtension}
          onExportCreated={exportCreated}
          onDelete={deleteCreated}
          onUninstall={uninstallExtension}
          onCreate={() => props.navigation.navigate("ThemeEditor", {})}
        />
        <Text style={styles.hint}>Touch and hold a theme to edit, duplicate, export, or remove it.</Text>

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

interface ThemeListProps {
  readonly contentWidth: number;
  readonly themes: ReadonlyArray<SelectableTheme>;
  readonly created: ReadonlyArray<CreatedTheme>;
  readonly enabled: CodeTheme | undefined;
  readonly onSelectDefault: () => void;
  readonly onSelectExtension: (t: SelectableTheme) => void;
  readonly onSelectCreated: (mine: CreatedTheme) => void;
  readonly onView: (t: SelectableTheme) => void;
  readonly onEdit: (mine: CreatedTheme) => void;
  readonly onDuplicateExtension: (t: SelectableTheme) => void;
  readonly onDuplicateCreated: (mine: CreatedTheme) => void;
  readonly onExportExtension: (t: SelectableTheme) => void;
  readonly onExportCreated: (mine: CreatedTheme) => void;
  readonly onDelete: (mine: CreatedTheme) => void;
  readonly onUninstall: (t: SelectableTheme) => void;
  readonly onCreate: () => void;
}

/** The compact card face of one theme row: a colour dot, the name, and a
 * checkmark when it is the enabled theme. This is the `ContextMenu.Trigger`, so
 * it is what iOS lifts on a long-press. */
const ThemeRowCard = (props: {
  readonly width: number;
  readonly dot: string;
  readonly label: string;
  readonly active: boolean;
}): React.ReactElement => (
  <HStack
    spacing={12}
    modifiers={[frame({ width: props.width, alignment: "leading" }), padding({ horizontal: 16, vertical: 14 }), background(colors.cardBackground), cornerRadius(14)]}
  >
    <Circle modifiers={[frame({ width: 22, height: 22 }), foregroundStyle(props.dot)]} />
    <UIText modifiers={[font({ size: 16 }), foregroundStyle(colors.label), lineLimit(1)]}>{props.label}</UIText>
    <Spacer />
    {props.active ? <Image systemName="checkmark" size={16} color={colors.tint} /> : null}
  </HStack>
);

/** The enlarged card shown above the menu while a row is long-pressed. */
const ThemeRowPreview = (props: {
  readonly width: number;
  readonly dot: string;
  readonly label: string;
  readonly subtitle: string;
}): React.ReactElement => (
  <VStack
    alignment="leading"
    spacing={10}
    modifiers={[padding({ all: 18 }), frame({ width: props.width, alignment: "leading" }), background(colors.cardBackground), cornerRadius(16)]}
  >
    <HStack spacing={10} alignment="center">
      <Circle modifiers={[frame({ width: 24, height: 24 }), foregroundStyle(props.dot)]} />
      <UIText modifiers={[font({ size: 20, weight: "semibold" }), foregroundStyle(colors.label), lineLimit(1)]}>{props.label}</UIText>
    </HStack>
    <UIText modifiers={[font({ size: 14 }), foregroundStyle(colors.secondaryLabel)]}>{props.subtitle}</UIText>
  </VStack>
);

/**
 * The one combined theme list: Default, every installed and device-created
 * theme, then "Create theme…". Tap selects; long-press opens a native context
 * menu whose items differ for an installed theme (view / uninstall) versus one
 * created here (edit / delete).
 *
 * Each row is its own `Host` carrying a single `ContextMenu` — the same shape as
 * the Home session cards, which is what makes the long-press work. They stack
 * with a small gap rather than grouping into one inset card, because a native
 * context menu lifts a whole `Host`, not a row inside a shared one.
 */
const ThemeList = (props: ThemeListProps): React.ReactElement => {
  const { contentWidth, themes, created, enabled } = props;
  const dotOf = (color: string | undefined): string => toOpaqueHex(color) ?? DEFAULT_THEME.primary;

  return (
    <View style={styles.themeStack}>
      <Host style={styles.themeCardHost} matchContents={{ vertical: true, horizontal: false }}>
        <VStack modifiers={[onTapGesture(props.onSelectDefault)]}>
          <ThemeRowCard width={contentWidth} dot={DEFAULT_THEME.primary} label="Default" active={enabled === undefined} />
        </VStack>
      </Host>

      {themes.map((t) => (
        <Host key={t.key} style={styles.themeCardHost} matchContents={{ vertical: true, horizontal: false }}>
          <ContextMenu>
            <ContextMenu.Items>
              <Button label="View Properties" systemImage="eye" onPress={() => props.onView(t)} />
              <Button label="Duplicate Theme" systemImage="doc.on.doc" onPress={() => props.onDuplicateExtension(t)} />
              <Button label="Export Theme as JSON" systemImage="square.and.arrow.up" onPress={() => props.onExportExtension(t)} />
              <Section>
                <Button label={`Uninstall Extension ${t.extName}`} role="destructive" systemImage="trash" onPress={() => props.onUninstall(t)} />
              </Section>
            </ContextMenu.Items>
            <ContextMenu.Preview>
              <ThemeRowPreview width={contentWidth} dot={dotOf(t.primary)} label={t.label} subtitle={t.extName} />
            </ContextMenu.Preview>
            <ContextMenu.Trigger>
              <VStack modifiers={[onTapGesture(() => props.onSelectExtension(t))]}>
                <ThemeRowCard
                  width={contentWidth}
                  dot={dotOf(t.primary)}
                  label={t.label}
                  active={enabled?.createdId === undefined && enabled?.file === t.file}
                />
              </VStack>
            </ContextMenu.Trigger>
          </ContextMenu>
        </Host>
      ))}

      {created.map((mine) => (
        <Host key={mine.id} style={styles.themeCardHost} matchContents={{ vertical: true, horizontal: false }}>
          <ContextMenu>
            <ContextMenu.Items>
              <Button label="Edit Properties" systemImage="slider.horizontal.3" onPress={() => props.onEdit(mine)} />
              <Button label="Duplicate Theme" systemImage="doc.on.doc" onPress={() => props.onDuplicateCreated(mine)} />
              <Button label="Export Theme as JSON" systemImage="square.and.arrow.up" onPress={() => props.onExportCreated(mine)} />
              <Section>
                <Button label="Delete Theme" role="destructive" systemImage="trash" onPress={() => props.onDelete(mine)} />
              </Section>
            </ContextMenu.Items>
            <ContextMenu.Preview>
              <ThemeRowPreview width={contentWidth} dot={dotOf(mine.theme.colors["editor.background"])} label={mine.theme.name} subtitle="Created on this device" />
            </ContextMenu.Preview>
            <ContextMenu.Trigger>
              <VStack modifiers={[onTapGesture(() => props.onSelectCreated(mine))]}>
                <ThemeRowCard
                  width={contentWidth}
                  dot={dotOf(mine.theme.colors["editor.background"])}
                  label={mine.theme.name}
                  active={enabled?.createdId === mine.id}
                />
              </VStack>
            </ContextMenu.Trigger>
          </ContextMenu>
        </Host>
      ))}

      <Host style={styles.themeCardHost} matchContents={{ vertical: true, horizontal: false }}>
        <VStack modifiers={[onTapGesture(props.onCreate)]}>
          <HStack
            spacing={12}
            modifiers={[frame({ width: contentWidth, alignment: "leading" }), padding({ horizontal: 16, vertical: 14 }), background(colors.cardBackground), cornerRadius(14)]}
          >
            <Image systemName="plus" size={18} color={colors.tint} />
            <UIText modifiers={[font({ size: 16 }), foregroundStyle(colors.tint), lineLimit(1)]}>Create theme…</UIText>
            <Spacer />
          </HStack>
        </VStack>
      </Host>
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
  themeStack: {
    // Cancel the screen's 16pt content padding so the row Hosts can carry their
    // own horizontal margin instead. A native Host does not inherit RN parent
    // padding the way the section labels do (matchContents.horizontal is off,
    // so its width is not derived from the SwiftUI content), so relying on the
    // content padding let the cards bleed to the screen edges — the same reason
    // the Home session/repo cards set their margin on the Host itself.
    marginHorizontal: -16,
    marginTop: 2,
  },
  themeCardHost: {
    // Each row is its own Host (so its context menu can lift the whole card);
    // the horizontal margin insets it to match the labels, and a small bottom
    // gap stacks them like the Home session cards.
    marginHorizontal: 16,
    marginBottom: 8,
  },
  themeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 10,
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
  swatchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 14,
    paddingTop: 4,
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
  pickerSwatch: {
    width: 32,
    height: 32,
  },
});
