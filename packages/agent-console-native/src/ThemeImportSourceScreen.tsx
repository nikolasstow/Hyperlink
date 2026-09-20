/**
 * Pick the theme to import values from.
 *
 * Grouped by where a theme came from, because that is the distinction that
 * decides what you can do with it elsewhere: installed themes are read-only
 * files in the extension store, created ones are documents this app owns. Both
 * are importable, since copying your own syntax rules into a new experiment is
 * the same operation as copying someone else's.
 *
 * Each row carries the number of colour keys that theme sets, which is the
 * useful fact before you go digging: a stock Dark+ sets a few dozen, Dracula
 * sets nearly two hundred.
 *
 * @internal
 */
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import * as React from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAppContext } from "./AppContext";
import { colors } from "./colors";
import { listCreatedThemes, type CreatedTheme } from "./createdThemes";
import { listExtensions, type ThemeContribution } from "./extensionsClient";
import { getApiAddress } from "./settings";
import type { RootStackParamList } from "./RootNavigator";
import { SystemIcon } from "./SystemIcon";
import { useThemeDraft } from "./themeDraft";

type Props = NativeStackScreenProps<RootStackParamList, "ThemeImportSource">;

interface InstalledSource {
  readonly key: string;
  readonly label: string;
  readonly file: string;
  readonly swatch: string | undefined;
}

export const ThemeImportSourceScreen = (props: Props): React.ReactElement => {
  const insets = useSafeAreaInsets();
  const { address } = useAppContext();
  const apiBase = getApiAddress(address);
  const draft = useThemeDraft();

  const [installed, setInstalled] = React.useState<ReadonlyArray<InstalledSource>>([]);
  const [created, setCreated] = React.useState<ReadonlyArray<CreatedTheme>>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | undefined>(undefined);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      const mine = await listCreatedThemes();
      if (!cancelled) setCreated(mine);
      try {
        const extensions = await listExtensions(apiBase);
        if (cancelled) return;
        const sources: Array<InstalledSource> = [];
        for (const extension of extensions) {
          for (const contribution of extension.colorThemes) {
            sources.push(toSource(extension.id, contribution));
          }
        }
        setInstalled(sources);
        setError(undefined);
      } catch (failure: unknown) {
        // A failure keeps whatever is already listed and says why, rather than
        // rendering an empty list that reads as "you have no themes".
        if (!cancelled) setError(failure instanceof Error ? failure.message : "Could not list installed themes.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiBase]);

  const openValues = (file: string, label: string): void => props.navigation.navigate("ThemeImportValues", { file, label });

  return (
    <ScrollView
      style={styles.root}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
    >
      {error === undefined ? null : <Text style={styles.errorText}>{error}</Text>}

      <Text style={styles.sectionLabel}>Installed</Text>
      <View style={styles.card}>
        {loading && installed.length === 0 ? (
          <ActivityIndicator style={styles.loading} size="small" color={colors.secondaryLabel} />
        ) : installed.length === 0 ? (
          <Text style={styles.empty}>No colour themes installed. Add one from Extensions.</Text>
        ) : (
          installed.map((source, index) => (
            <TouchableOpacity
              key={source.key}
              style={[styles.row, index > 0 && styles.rowBorder]}
              activeOpacity={0.6}
              onPress={() => openValues(source.file, source.label)}
            >
              <View
                style={[
                  styles.swatch,
                  source.swatch === undefined ? styles.swatchEmpty : { backgroundColor: source.swatch },
                ]}
              />
              <Text style={styles.rowTitle} numberOfLines={1}>
                {source.label}
              </Text>
              <SystemIcon name="chevron.right" size={13} color={colors.tertiaryLabel} />
            </TouchableOpacity>
          ))
        )}
      </View>

      {created.length === 0 ? null : (
        <>
          <Text style={styles.sectionLabel}>Themes you made</Text>
          <View style={styles.card}>
            {created
              .filter((mine) => draft.kind !== "open" || mine.id !== draft.id)
              .map((mine, index) => (
                <TouchableOpacity
                  key={mine.id}
                  style={[styles.row, index > 0 && styles.rowBorder]}
                  activeOpacity={0.6}
                  onPress={() => openValues(`created:${mine.id}`, mine.theme.name)}
                >
                  <View
                    style={[
                      styles.swatch,
                      { backgroundColor: mine.theme.colors["editor.background"] ?? colors.fillBackground },
                    ]}
                  />
                  <Text style={styles.rowTitle} numberOfLines={1}>
                    {mine.theme.name}
                  </Text>
                  <Text style={styles.rowValue}>{Object.keys(mine.theme.colors).length}</Text>
                  <SystemIcon name="chevron.right" size={13} color={colors.tertiaryLabel} />
                </TouchableOpacity>
              ))}
          </View>
        </>
      )}
    </ScrollView>
  );
};

/** The accent the server already derived for a theme, so the swatch is a real value. */
const toSource = (extensionId: string, contribution: ThemeContribution): InstalledSource => ({
  key: `${extensionId}:${contribution.file}`,
  label: contribution.label,
  file: contribution.file,
  swatch: contribution.colors?.primary,
});

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
  rowValue: {
    color: colors.secondaryLabel,
    fontSize: 14,
    fontFamily: "Menlo",
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
  loading: {
    paddingVertical: 20,
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
    marginTop: 12,
    marginHorizontal: 5,
  },
});
