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
import { addCustomFont, inspectFont, type FontDetails } from "./fontsClient";
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

  const onImport = React.useCallback((): void => {
    if (details === undefined) return;
    addCustomFont(apiBase, { family: details.family, url: savedUrl })
      .then(() => navigation.goBack())
      .catch((e: unknown) => setError(String(e)));
  }, [apiBase, details, savedUrl, navigation]);

  const backToChoose = React.useCallback((): void => {
    setStep("choose");
    setDetails(undefined);
    setError(undefined);
  }, []);

  // Header buttons follow the step: Close + (spinner while validating) on choose;
  // Back + Import on details.
  React.useEffect(() => {
    if (step === "choose") {
      navigation.setOptions({
        unstable_headerLeftItems: () => [
          { type: "button", label: "Close", icon: { type: "sfSymbol", name: "xmark" }, onPress: () => navigation.goBack() },
        ],
        unstable_headerRightItems: () => (validating ? [{ type: "custom", element: <ActivityIndicator color={colors.tint} /> }] : []),
      });
    } else {
      navigation.setOptions({
        unstable_headerLeftItems: () => [
          { type: "button", label: "Back", icon: { type: "sfSymbol", name: "chevron.backward" }, onPress: backToChoose },
        ],
        unstable_headerRightItems: () => [{ type: "button", label: "Import", variant: "prominent", onPress: onImport }],
      });
    }
  }, [step, validating, navigation, onImport, backToChoose]);

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.center} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
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
            <Text style={styles.supportedText}>Supports TrueType (.ttf) and OpenType (.otf).</Text>
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
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
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
