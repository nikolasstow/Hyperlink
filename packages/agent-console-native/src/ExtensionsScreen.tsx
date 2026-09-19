/**
 * Install and manage VS Code extensions — talks to the off-vite Effect API
 * server (extensionsClient.ts). Install by marketplace reference
 * (`publisher.name` or a marketplace URL); installed extensions list what they
 * contribute (icon / color themes) and can be removed. File upload is a later
 * step — it needs a multipart endpoint and a build that bundles
 * `expo-document-picker`.
 *
 * @internal
 */
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import * as React from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAppContext } from "./AppContext";
import { colors } from "./colors";
import {
  discoverLocalExtensions,
  importLocalExtension,
  installExtension,
  listExtensions,
  removeExtension,
  type ExtensionManifest,
  type LocalExtension,
} from "./extensionsClient";
import type { RootStackParamList } from "./RootNavigator";
import { getApiAddress } from "./settings";
import { SystemIcon } from "./SystemIcon";

type Props = NativeStackScreenProps<RootStackParamList, "Extensions">;

export const ExtensionsScreen = (props: Props): React.ReactElement => {
  const { address } = useAppContext();
  const insets = useSafeAreaInsets();
  const apiBase = getApiAddress(address);

  const [items, setItems] = React.useState<ReadonlyArray<ExtensionManifest>>([]);
  const [local, setLocal] = React.useState<ReadonlyArray<LocalExtension>>([]);
  const [ref, setRef] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const [installing, setInstalling] = React.useState(false);
  const [importingId, setImportingId] = React.useState<string | undefined>(undefined);
  const [error, setError] = React.useState<string | undefined>(undefined);

  const load = React.useCallback((): void => {
    setLoading(true);
    listExtensions(apiBase)
      .then((list) => {
        setItems(list);
        setError(undefined);
      })
      .catch((e: unknown) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [apiBase]);

  const discover = React.useCallback((): void => {
    discoverLocalExtensions(apiBase)
      .then(setLocal)
      .catch(() => undefined);
  }, [apiBase]);

  React.useEffect(() => {
    load();
    discover();
  }, [load, discover]);

  const installedIds = React.useMemo(() => new Set(items.map((x) => x.id)), [items]);

  const onImport = (ext: LocalExtension): void => {
    if (importingId !== undefined) return;
    setImportingId(ext.id);
    setError(undefined);
    importLocalExtension(apiBase, ext.sourcePath)
      .then(() => load())
      .catch((e: unknown) => setError(String(e)))
      .finally(() => setImportingId(undefined));
  };

  const onInstall = (): void => {
    const value = ref.trim();
    if (value === "" || installing) return;
    setInstalling(true);
    setError(undefined);
    installExtension(apiBase, value)
      .then(() => {
        setRef("");
        load();
      })
      .catch((e: unknown) => setError(String(e)))
      .finally(() => setInstalling(false));
  };

  const onRemove = (id: string): void => {
    removeExtension(apiBase, id)
      .then(load)
      .catch((e: unknown) => setError(String(e)));
  };

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity style={styles.backButton} onPress={() => props.navigation.goBack()} accessibilityLabel="Back">
          <SystemIcon name="chevron.left" size={20} color={colors.tint} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Extensions</Text>
        <View style={styles.backButton} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <Text style={styles.sectionLabel}>Install from Marketplace</Text>
        <View style={styles.card}>
          <Text style={styles.hint}>A publisher.extension id (e.g. dracula-theme.theme-dracula) or a marketplace URL.</Text>
          <View style={styles.installRow}>
            <TextInput
              style={styles.input}
              value={ref}
              onChangeText={setRef}
              placeholder="publisher.extension"
              placeholderTextColor={colors.placeholderText}
              autoCapitalize="none"
              autoCorrect={false}
              onSubmitEditing={onInstall}
              returnKeyType="go"
            />
            <TouchableOpacity
              style={[styles.installButton, (installing || ref.trim() === "") && styles.installButtonDisabled]}
              onPress={onInstall}
              disabled={installing || ref.trim() === ""}
            >
              {installing ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.installButtonText}>Install</Text>}
            </TouchableOpacity>
          </View>
          {error !== undefined ? <Text style={styles.errorText}>{error}</Text> : null}
        </View>

        {local.length > 0 ? (
          <>
            <Text style={styles.sectionLabel}>Available on this machine</Text>
            {local.map((ext) => {
              const already = installedIds.has(ext.id);
              return (
                <View key={`${ext.source}:${ext.id}`} style={styles.card}>
                  <View style={styles.extHeader}>
                    <View style={styles.extText}>
                      <Text style={styles.extName} numberOfLines={1}>
                        {ext.displayName}
                      </Text>
                      <Text style={styles.extMeta} numberOfLines={1}>
                        {ext.source} · {contributes(ext)}
                      </Text>
                    </View>
                    {already ? (
                      <Text style={styles.importedText}>Imported</Text>
                    ) : (
                      <TouchableOpacity onPress={() => onImport(ext)} disabled={importingId !== undefined} accessibilityLabel="Import">
                        {importingId === ext.id ? <ActivityIndicator color={colors.tint} /> : <Text style={styles.importText}>Import</Text>}
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              );
            })}
          </>
        ) : null}

        <Text style={styles.sectionLabel}>Installed</Text>
        {loading ? (
          <ActivityIndicator style={styles.loading} color={colors.secondaryLabel} />
        ) : items.length === 0 ? (
          <Text style={styles.empty}>No extensions installed.</Text>
        ) : (
          items.map((ext) => (
            <View key={ext.id} style={styles.card}>
              <View style={styles.extHeader}>
                <View style={styles.extText}>
                  <Text style={styles.extName} numberOfLines={1}>
                    {ext.displayName}
                  </Text>
                  <Text style={styles.extMeta} numberOfLines={1}>
                    {ext.id} · {ext.version}
                  </Text>
                </View>
                <TouchableOpacity onPress={() => onRemove(ext.id)} accessibilityLabel="Remove">
                  <Text style={styles.removeText}>Remove</Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.extContributes}>{contributes(ext)}</Text>
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
};

const contributes = (ext: ExtensionManifest): string => {
  const parts: string[] = [];
  if (ext.colorThemes.length > 0) parts.push(`${ext.colorThemes.length} color theme${ext.colorThemes.length === 1 ? "" : "s"}`);
  if (ext.iconThemes.length > 0) parts.push(`${ext.iconThemes.length} icon theme${ext.iconThemes.length === 1 ? "" : "s"}`);
  return parts.length === 0 ? "No supported contributions" : parts.join(" · ");
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingBottom: 8,
  },
  backButton: {
    width: 44,
    height: 32,
    justifyContent: "center",
  },
  headerTitle: {
    flex: 1,
    textAlign: "center",
    color: colors.label,
    fontSize: 17,
    fontWeight: "600",
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
    marginBottom: 10,
    gap: 8,
  },
  hint: {
    color: colors.secondaryLabel,
    fontSize: 13,
  },
  installRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  input: {
    flex: 1,
    color: colors.label,
    fontSize: 16,
    paddingVertical: 8,
    paddingHorizontal: 10,
    backgroundColor: colors.fillBackground,
    borderRadius: 8,
  },
  installButton: {
    backgroundColor: colors.tint,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    minWidth: 84,
    alignItems: "center",
  },
  installButtonDisabled: {
    opacity: 0.4,
  },
  installButtonText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "600",
  },
  errorText: {
    color: colors.destructive,
    fontSize: 13,
  },
  loading: {
    marginTop: 16,
  },
  empty: {
    color: colors.secondaryLabel,
    fontSize: 15,
    textAlign: "center",
    marginTop: 16,
  },
  extHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  extText: {
    flex: 1,
  },
  extName: {
    color: colors.label,
    fontSize: 16,
    fontWeight: "600",
  },
  extMeta: {
    color: colors.secondaryLabel,
    fontSize: 13,
    marginTop: 2,
  },
  removeText: {
    color: colors.destructive,
    fontSize: 15,
  },
  importText: {
    color: colors.tint,
    fontSize: 15,
    fontWeight: "600",
  },
  importedText: {
    color: colors.secondaryLabel,
    fontSize: 15,
  },
  extContributes: {
    color: colors.secondaryLabel,
    fontSize: 13,
  },
});
