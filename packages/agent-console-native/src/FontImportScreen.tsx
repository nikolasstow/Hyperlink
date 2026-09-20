/**
 * Import custom code fonts — presented as a native slide-up modal. Two ways in:
 * from a URL (a direct .ttf/.otf/.woff2 link) or from a file. The font's family
 * name is read from the file itself (server-side inspect), so you don't type it;
 * after loading, a preview shows before you save it to your fonts.
 *
 * Fonts live in the synced config (fontsClient.ts). File import and actually
 * *rendering* a custom font need `expo-font` (a native module → a build); URL
 * inspect + add works now, and a saved font applies once that build lands.
 *
 * @internal
 */
import * as React from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAppContext } from "./AppContext";
import { colors } from "./colors";
import { addCustomFont, inspectFont, type CustomFont } from "./fontsClient";
import { getApiAddress } from "./settings";

export const FontImportScreen = (): React.ReactElement => {
  const { address } = useAppContext();
  const insets = useSafeAreaInsets();
  const apiBase = getApiAddress(address);

  const [showUrl, setShowUrl] = React.useState(false);
  const [urlInput, setUrlInput] = React.useState("");
  const [pending, setPending] = React.useState<CustomFont | undefined>(undefined);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | undefined>(undefined);

  const onLoadUrl = (): void => {
    const url = urlInput.trim();
    if (url === "" || busy) return;
    setBusy(true);
    setError(undefined);
    inspectFont(apiBase, url)
      .then((family) => {
        setPending({ family, url });
        setShowUrl(false);
        setUrlInput("");
      })
      .catch((e: unknown) => setError(String(e)))
      .finally(() => setBusy(false));
  };

  const onSave = (): void => {
    if (pending === undefined || busy) return;
    setBusy(true);
    addCustomFont(apiBase, pending)
      .then(() => setPending(undefined))
      .catch((e: unknown) => setError(String(e)))
      .finally(() => setBusy(false));
  };

  return (
    <ScrollView
      style={styles.root}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
    >
      <View style={styles.card}>
        <View style={styles.buttonRow}>
          <TouchableOpacity style={styles.choice} onPress={() => setShowUrl((s) => !s)} activeOpacity={0.6}>
            <Text style={styles.choiceText}>Import from URL</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.choice, styles.choiceMuted]}
            onPress={() => setError("File import needs an app build (adds the document picker).")}
            activeOpacity={0.6}
          >
            <Text style={styles.choiceText}>Import from File</Text>
          </TouchableOpacity>
        </View>
        {showUrl ? (
          <View style={styles.urlRow}>
            <TextInput
              style={styles.input}
              value={urlInput}
              onChangeText={setUrlInput}
              placeholder="https://…/font.ttf"
              placeholderTextColor={colors.placeholderText}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              onSubmitEditing={onLoadUrl}
              returnKeyType="go"
            />
            <TouchableOpacity style={styles.loadButton} onPress={onLoadUrl} disabled={busy || urlInput.trim() === ""}>
              {busy && pending === undefined ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.loadButtonText}>Load</Text>}
            </TouchableOpacity>
          </View>
        ) : null}
        {error !== undefined ? <Text style={styles.errorText}>{error}</Text> : null}
      </View>

      {pending !== undefined ? (
        <>
          <Text style={styles.sectionLabel}>Preview</Text>
          <View style={styles.card}>
            <Text style={styles.previewFamily}>{pending.family}</Text>
            <Text style={[styles.previewSample, { fontFamily: pending.family }]}>The quick brown fox 0123 {"{}"} =&gt;</Text>
            <Text style={styles.note}>Name read from the file. Renders in this font after an app build.</Text>
            <View style={styles.saveRow}>
              <TouchableOpacity onPress={() => setPending(undefined)}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveButton} onPress={onSave} disabled={busy}>
                {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.saveButtonText}>Save to fonts</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </>
      ) : null}
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
    paddingTop: 12,
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
  buttonRow: {
    flexDirection: "row",
    gap: 10,
  },
  choice: {
    flex: 1,
    backgroundColor: colors.fillBackground,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
  },
  choiceMuted: {
    opacity: 0.6,
  },
  choiceText: {
    color: colors.tint,
    fontSize: 15,
    fontWeight: "600",
  },
  urlRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  input: {
    flex: 1,
    color: colors.label,
    fontSize: 16,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: colors.fillBackground,
    borderRadius: 8,
  },
  loadButton: {
    backgroundColor: colors.tint,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    minWidth: 68,
    alignItems: "center",
  },
  loadButtonText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "600",
  },
  errorText: {
    color: colors.destructive,
    fontSize: 13,
  },
  note: {
    color: colors.secondaryLabel,
    fontSize: 12,
  },
  previewFamily: {
    color: colors.label,
    fontSize: 17,
    fontWeight: "600",
  },
  previewSample: {
    color: colors.label,
    fontSize: 18,
  },
  saveRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 18,
    paddingTop: 2,
  },
  cancelText: {
    color: colors.secondaryLabel,
    fontSize: 15,
  },
  saveButton: {
    backgroundColor: colors.tint,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    minWidth: 120,
    alignItems: "center",
  },
  saveButtonText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "600",
  },
});
