/**
 * Import a custom code font — a native half-height slide-up sheet, two steps:
 *
 *  1. Choose: centered "Import from URL" (a URL field with an example
 *     placeholder — no submit button; hit return or tap out and we validate),
 *     an "or" divider, then "Import from File" with its button.
 *  2. Details: the font's details (read from the file); Import (top-right) saves
 *     it, Back (top-left) returns if it's the wrong font.
 *
 * Validating shows a spinner in the header and transitions to step 2 as soon as
 * the details are ready. Fonts live in the synced config (fontsClient.ts). File
 * import and rendering a custom font need `expo-font` (a build); URL works now.
 *
 * @internal
 */
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import * as React from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useAppContext } from "./AppContext";
import { colors } from "./colors";
import { addCustomFont, importFontFile, inspectFont, type FontDetails } from "./fontsClient";
import type { RootStackParamList } from "./RootNavigator";
import { getApiAddress } from "./settings";
import { SystemIcon } from "./SystemIcon";

type Props = NativeStackScreenProps<RootStackParamList, "FontImport">;

const DetailRow = (props: { readonly label: string; readonly value: string }): React.ReactElement => (
  <View style={styles.detailRow}>
    <Text style={styles.detailKey}>{props.label}</Text>
    <Text style={styles.detailVal} numberOfLines={2}>
      {props.value}
    </Text>
  </View>
);

export const FontImportScreen = ({ navigation }: Props): React.ReactElement => {
  const { address } = useAppContext();
  const apiBase = getApiAddress(address);

  const [step, setStep] = React.useState<"choose" | "details">("choose");
  const [urlInput, setUrlInput] = React.useState("");
  const [validating, setValidating] = React.useState(false);
  const [details, setDetails] = React.useState<FontDetails | undefined>(undefined);
  const [savedUrl, setSavedUrl] = React.useState("");
  const [error, setError] = React.useState<string | undefined>(undefined);
  const inFlight = React.useRef(false);

  const validate = React.useCallback(
    (raw: string): void => {
      const url = raw.trim();
      if (url === "" || inFlight.current) return;
      inFlight.current = true;
      setValidating(true);
      setError(undefined);
      inspectFont(apiBase, url)
        .then((d) => {
          setDetails(d);
          setSavedUrl(url);
          setStep("details");
        })
        .catch((e: unknown) => setError(String(e)))
        .finally(() => {
          inFlight.current = false;
          setValidating(false);
        });
    },
    [apiBase],
  );

  const [importing, setImporting] = React.useState(false);
  const onImport = React.useCallback((): void => {
    if (details === undefined || importing) return;
    setImporting(true);
    setError(undefined);
    // Convert + store on the server, then record the served path on the font.
    importFontFile(apiBase, savedUrl)
      .then(({ family, servedPath }) => addCustomFont(apiBase, { family, url: servedPath }))
      .then(() => navigation.goBack())
      .catch((e: unknown) => setError(String(e)))
      .finally(() => setImporting(false));
  }, [apiBase, details, savedUrl, navigation, importing]);

  const backToChoose = React.useCallback((): void => {
    setStep("choose");
    setDetails(undefined);
    setError(undefined);
  }, []);

  return (
    <View style={styles.root}>
      {/* Single header row, in-content (no native bar): Close/Back at left,
       * spinner or Import at right. */}
      <View style={styles.topBar}>
        {step === "choose" ? (
          <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={10} accessibilityLabel="Close">
            <SystemIcon name="xmark" size={17} color={colors.secondaryLabel} />
          </TouchableOpacity>
        ) : (
          <TouchableOpacity onPress={backToChoose} hitSlop={10} accessibilityLabel="Back">
            <SystemIcon name="chevron.backward" size={18} color={colors.tint} />
          </TouchableOpacity>
        )}
        <View style={styles.topRight}>
          {step === "choose" ? (
            validating ? <ActivityIndicator color={colors.tint} /> : null
          ) : importing ? (
            <ActivityIndicator color={colors.tint} />
          ) : (
            <TouchableOpacity onPress={onImport} hitSlop={10} accessibilityLabel="Import">
              <Text style={styles.importText}>Import</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.center} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
      {step === "choose" ? (
        <View style={styles.block}>
          <View style={styles.iconBadge}>
            <SystemIcon name="textformat" size={28} color={colors.tint} />
          </View>
          <Text style={styles.title}>Add a code font</Text>
          <Text style={styles.subtitle}>Bring your own coding font by link or file.</Text>

          <Text style={styles.heading}>Import from URL</Text>
          <TextInput
            style={styles.input}
            value={urlInput}
            onChangeText={setUrlInput}
            placeholder="https://example.com/FiraCode-Regular.ttf"
            placeholderTextColor={colors.placeholderText}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            returnKeyType="go"
            editable={!validating}
            onSubmitEditing={() => validate(urlInput)}
            onBlur={() => validate(urlInput)}
          />

          <View style={styles.divider}>
            <View style={styles.line} />
            <Text style={styles.or}>or</Text>
            <View style={styles.line} />
          </View>

          <Text style={styles.heading}>Import from File</Text>
          <TouchableOpacity
            style={styles.fileButton}
            onPress={() => setError("File import needs an app build (adds the document picker).")}
            activeOpacity={0.7}
          >
            <SystemIcon name="doc.badge.plus" size={16} color={colors.tint} />
            <Text style={styles.fileButtonText}>Choose file…</Text>
          </TouchableOpacity>

          <View style={styles.supported}>
            <SystemIcon name="info.circle" size={13} color={colors.secondaryLabel} />
            <Text style={styles.supportedText}>Supports .ttf, .otf, and .woff2 (converted automatically).</Text>
          </View>

          {error !== undefined ? <Text style={styles.error}>{error}</Text> : null}
        </View>
      ) : details !== undefined ? (
        <View style={styles.block}>
          <Text style={[styles.family, { fontFamily: details.family }]}>{details.fullName ?? details.family}</Text>
          <Text style={[styles.sample, { fontFamily: details.family }]}>The quick brown fox 0123 {"{}"} =&gt;</Text>
          <View style={styles.detailList}>
            <DetailRow label="Family" value={details.family} />
            {details.subfamily !== undefined ? <DetailRow label="Style" value={details.subfamily} /> : null}
            {details.version !== undefined ? <DetailRow label="Version" value={details.version} /> : null}
            {details.numGlyphs !== undefined ? <DetailRow label="Glyphs" value={String(details.numGlyphs)} /> : null}
            {details.copyright !== undefined ? <DetailRow label="Copyright" value={details.copyright} /> : null}
          </View>
          {error !== undefined ? <Text style={styles.error}>{error}</Text> : null}
        </View>
      ) : null}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 4,
    minHeight: 44,
  },
  topRight: {
    minWidth: 64,
    alignItems: "flex-end",
  },
  importText: {
    color: colors.tint,
    fontSize: 16,
    fontWeight: "700",
  },
  scroll: {
    flex: 1,
  },
  center: {
    flexGrow: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 24,
    paddingVertical: 24,
  },
  block: {
    width: "100%",
    maxWidth: 460,
    alignItems: "center",
    gap: 14,
  },
  iconBadge: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.accentTint,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 2,
  },
  title: {
    color: colors.label,
    fontSize: 22,
    fontWeight: "700",
    textAlign: "center",
  },
  subtitle: {
    color: colors.secondaryLabel,
    fontSize: 14,
    textAlign: "center",
    marginTop: -6,
    marginBottom: 4,
  },
  heading: {
    color: colors.secondaryLabel,
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0.6,
    textTransform: "uppercase",
    textAlign: "center",
  },
  input: {
    width: "100%",
    color: colors.label,
    fontSize: 16,
    textAlign: "center",
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: colors.fillBackground,
    borderRadius: 10,
    borderCurve: "continuous",
  },
  divider: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    width: "70%",
    marginVertical: 4,
  },
  line: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.separator,
  },
  or: {
    color: colors.secondaryLabel,
    fontSize: 13,
  },
  fileButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderRadius: 12,
    borderCurve: "continuous",
    backgroundColor: colors.accentTint,
  },
  fileButtonText: {
    color: colors.tint,
    fontSize: 15,
    fontWeight: "600",
  },
  supported: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 6,
  },
  supportedText: {
    color: colors.secondaryLabel,
    fontSize: 12,
  },
  error: {
    color: colors.destructive,
    fontSize: 13,
    textAlign: "center",
  },
  family: {
    color: colors.label,
    fontSize: 26,
    fontWeight: "700",
    textAlign: "center",
  },
  sample: {
    color: colors.secondaryLabel,
    fontSize: 17,
    textAlign: "center",
  },
  detailList: {
    width: "100%",
    marginTop: 6,
    gap: 8,
  },
  detailRow: {
    flexDirection: "row",
    gap: 12,
  },
  detailKey: {
    width: 96,
    color: colors.secondaryLabel,
    fontSize: 14,
  },
  detailVal: {
    flex: 1,
    color: colors.label,
    fontSize: 14,
  },
});
