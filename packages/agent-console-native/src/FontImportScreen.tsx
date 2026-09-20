/**
 * Import custom code fonts — add a font by URL (a direct .ttf/.otf/.woff2 link)
 * with a family name; list and remove them. Fonts live in the synced config
 * (fontsClient.ts), so they travel across devices.
 *
 * File upload and actually *rendering* a custom font need `expo-font` (a native
 * module → a build); adding/managing works now, and a selected custom font
 * applies once that build lands.
 *
 * @internal
 */
import * as React from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAppContext } from "./AppContext";
import { colors } from "./colors";
import { addCustomFont, getCustomFonts, removeCustomFont, type CustomFont } from "./fontsClient";
import { getApiAddress } from "./settings";

export const FontImportScreen = (): React.ReactElement => {
  const { address } = useAppContext();
  const insets = useSafeAreaInsets();
  const apiBase = getApiAddress(address);

  const [fonts, setFonts] = React.useState<ReadonlyArray<CustomFont>>([]);
  const [family, setFamily] = React.useState("");
  const [url, setUrl] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | undefined>(undefined);

  React.useEffect(() => {
    let cancelled = false;
    getCustomFonts(apiBase)
      .then((list) => {
        if (!cancelled) setFonts(list);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [apiBase]);

  const onAdd = (): void => {
    const f = family.trim();
    const u = url.trim();
    if (f === "" || u === "" || busy) return;
    setBusy(true);
    setError(undefined);
    addCustomFont(apiBase, { family: f, url: u })
      .then((list) => {
        setFonts(list);
        setFamily("");
        setUrl("");
      })
      .catch((e: unknown) => setError(String(e)))
      .finally(() => setBusy(false));
  };

  const onRemove = (fam: string): void => {
    removeCustomFont(apiBase, fam)
      .then(setFonts)
      .catch((e: unknown) => setError(String(e)));
  };

  return (
    <ScrollView
      style={styles.root}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
    >
      <Text style={styles.sectionLabel}>Add a font</Text>
      <View style={styles.card}>
        <Text style={styles.hint}>A family name and a direct link to a .ttf, .otf, or .woff2 file.</Text>
        <TextInput
          style={styles.input}
          value={family}
          onChangeText={setFamily}
          placeholder="Family name (e.g. JetBrains Mono)"
          placeholderTextColor={colors.placeholderText}
          autoCapitalize="words"
          autoCorrect={false}
        />
        <TextInput
          style={styles.input}
          value={url}
          onChangeText={setUrl}
          placeholder="https://…/font.ttf"
          placeholderTextColor={colors.placeholderText}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          onSubmitEditing={onAdd}
          returnKeyType="go"
        />
        <TouchableOpacity
          style={[styles.addButton, (busy || family.trim() === "" || url.trim() === "") && styles.addButtonDisabled]}
          onPress={onAdd}
          disabled={busy || family.trim() === "" || url.trim() === ""}
        >
          {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.addButtonText}>Add font</Text>}
        </TouchableOpacity>
        {error !== undefined ? <Text style={styles.errorText}>{error}</Text> : null}
        <Text style={styles.note}>Custom fonts render after an app build that bundles font loading; you can add and select them now.</Text>
      </View>

      <Text style={styles.sectionLabel}>Imported fonts</Text>
      {fonts.length === 0 ? (
        <Text style={styles.empty}>No custom fonts yet.</Text>
      ) : (
        fonts.map((font) => (
          <View key={font.family} style={styles.card}>
            <View style={styles.row}>
              <View style={styles.rowText}>
                <Text style={styles.family} numberOfLines={1}>
                  {font.family}
                </Text>
                <Text style={styles.url} numberOfLines={1}>
                  {font.url}
                </Text>
              </View>
              <TouchableOpacity onPress={() => onRemove(font.family)} accessibilityLabel="Remove">
                <Text style={styles.removeText}>Remove</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))
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
    marginBottom: 10,
    gap: 10,
  },
  hint: {
    color: colors.secondaryLabel,
    fontSize: 13,
  },
  note: {
    color: colors.secondaryLabel,
    fontSize: 12,
  },
  input: {
    color: colors.label,
    fontSize: 16,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: colors.fillBackground,
    borderRadius: 8,
  },
  addButton: {
    backgroundColor: colors.tint,
    borderRadius: 8,
    paddingVertical: 11,
    alignItems: "center",
  },
  addButtonDisabled: {
    opacity: 0.4,
  },
  addButtonText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "600",
  },
  errorText: {
    color: colors.destructive,
    fontSize: 13,
  },
  empty: {
    color: colors.secondaryLabel,
    fontSize: 15,
    textAlign: "center",
    marginTop: 8,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  rowText: {
    flex: 1,
  },
  family: {
    color: colors.label,
    fontSize: 16,
    fontWeight: "600",
  },
  url: {
    color: colors.secondaryLabel,
    fontSize: 13,
    marginTop: 2,
  },
  removeText: {
    color: colors.destructive,
    fontSize: 15,
  },
});
