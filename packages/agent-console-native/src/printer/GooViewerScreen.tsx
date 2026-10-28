/**
 * The printer plugin's `.goo` viewer (printer/gooViewer.ts), like Apple
 * Maps: the main view fills the page, and a glass panel slides up from the
 * bottom with the print's details.
 *
 * - The main view starts with the slicer's thumbnail and the progress of the
 *   3D model. The model's low level replaces it as soon as it is here, and
 *   the high level replaces that in place (the view stays).
 * - One finger turns the model, two fingers move it, a pinch zooms.
 * - The panel has the model's colour (Apple's colour picker and resin
 *   swatches), a crop (two grabbers pick a layer range and the model shows
 *   only those layers, so the inside shows), the print settings, and Print
 *   for a file on the printer.
 * - The panel stays: it rests low, and the model takes touches above it.
 *
 * It opens for the current print (by task id) or for any file (by path).
 *
 * @internal
 */
import {
  BottomSheet,
  Button,
  ColorPicker,
  Form,
  Group,
  Host,
  HStack,
  Image,
  LabeledContent,
  Section,
  Spacer,
  Text as SwiftText,
  Toggle,
  VStack,
} from "@expo/ui/swift-ui";
import {
  buttonStyle,
  disabled,
  font,
  foregroundStyle,
  interactiveDismissDisabled,
  presentationBackgroundInteraction,
  presentationDetents,
  presentationDragIndicator,
} from "@expo/ui/swift-ui/modifiers";
import { useHeaderHeight } from "@react-navigation/elements";
import { useIsFocused } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import * as React from "react";
import { Alert, Image as RNImage, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ModelViewer } from "../../modules/model-viewer";
import { showToast } from "../AppToast";
import { previewUrl } from "../explorer/httpFileSource";
import type { RootStackParamList } from "../RootNavigator";
import { useScreenBackground, useTextColors, withAlpha } from "../theme";
import { LayerRange, type Range } from "./LayerRange";
import { RESIN_SWATCHES, setModelColor, useModelColor } from "./modelColor";
import { fmtDuration, settingsCells } from "./printerFormat";
import { usePrintRunning } from "./printerPageLink";
import { usePrintModel, type ModelSource } from "./printModel";
import { fetchFileInfo, fetchPrintHeader, printFile, printPreviewUrl, type PrintHeader } from "./relayApi";
import { usePalette } from "./ui";

type Props = NativeStackScreenProps<RootStackParamList, "GooViewer">;

/** The panel's resting height: the name and the summary line. */
const PEEK_HEIGHT = 150;

const secondaryText = foregroundStyle({ type: "hierarchical", style: "secondary" });

/** The print file's header, loaded once per file. */
const useHeader = (relayBase: string, taskId: string | undefined, path: string | undefined): PrintHeader | undefined => {
  const [header, setHeader] = React.useState<PrintHeader | undefined>(undefined);
  React.useEffect(() => {
    let alive = true;
    const load = taskId !== undefined ? fetchPrintHeader(relayBase, taskId) : path !== undefined ? fetchFileInfo(relayBase, path) : undefined;
    load
      ?.then((next) => {
        if (alive) setHeader(next);
      })
      .catch((cause: unknown) => console.error("[printer] reading the print file's details failed", cause));
    return () => {
      alive = false;
    };
  }, [relayBase, taskId, path]);
  return header;
};

export const GooViewerScreen = (props: Props): React.ReactElement => {
  const { relayBase, path, taskId, name } = props.route.params;
  const text = useTextColors();
  const palette = usePalette();
  const background = useScreenBackground("plain");
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const focused = useIsFocused();
  const source = React.useMemo((): ModelSource | undefined => (taskId !== undefined ? { kind: "Print", taskId } : path !== undefined ? { kind: "File", path } : undefined), [taskId, path]);
  const { levels, best, bestLevel } = usePrintModel(relayBase, source);
  const header = useHeader(relayBase, taskId, path);
  const { color, custom } = useModelColor();
  const [crop, setCrop] = React.useState<Range | undefined>(undefined);
  const layerCount = best?.layerCount ?? header?.layerCount ?? 0;
  const layerHeight = best?.layerHeightMm ?? header?.layerHeightMm ?? 0;

  const thumbnail = taskId !== undefined ? printPreviewUrl(relayBase, taskId) : path !== undefined ? previewUrl(relayBase, path, true) : undefined;
  const title = name.replace(/\.goo$/i, "");
  const summary =
    header === undefined
      ? undefined
      : `${header.layerCount.toLocaleString()} layers · ${fmtDuration(header.printSeconds * 1000)} · ${header.volumeMl.toFixed(1)} ml`;

  // What the main view says while the model is on its way.
  const lowState = levels.low.state;
  const highState = levels.high.state;
  const progressOf = (state: typeof lowState): string | undefined =>
    state?.kind === "Building"
      ? `Making the 3D model · ${state.total > 0 ? Math.floor((state.done / state.total) * 100) : 0}%`
      : state?.kind === "Downloading"
        ? "Getting the 3D model"
        : state?.kind === "Failed"
          ? `No 3D model yet: ${state.reason}`
          : undefined;
  const note = best === undefined ? (progressOf(lowState) ?? "Getting the 3D model") : bestLevel === "low" && highState?.kind !== "Failed" ? "Getting full detail" : undefined;

  const onPrinter = path !== undefined && (path.startsWith("/local/") || path.startsWith("/usb/"));
  const running = usePrintRunning(relayBase);
  const canPrint = onPrinter && running === false;
  const print = (): void => {
    if (path === undefined || !canPrint) return;
    Alert.alert(`Print ${title}?`, "The printer starts from the first layer.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Print",
        onPress: () => {
          printFile(relayBase, path)
            .then(() => showToast({ message: `Printing ${title}` }))
            .catch((cause: unknown) => showToast({ message: cause instanceof Error ? cause.message : String(cause) }));
        },
      },
    ]);
  };

  const cropMm =
    crop === undefined || layerHeight <= 0 ? undefined : { low: (crop.from - 1) * layerHeight, high: crop.to * layerHeight };

  return (
    <View style={[styles.page, { backgroundColor: background }]}>
      {best === undefined && thumbnail !== undefined ? (
        <RNImage source={{ uri: thumbnail }} style={[styles.thumbnail, { top: headerHeight, bottom: PEEK_HEIGHT }]} resizeMode="contain" />
      ) : null}
      <ModelViewer style={StyleSheet.absoluteFill} uri={best?.uri} color={color} clipLowMm={cropMm?.low} clipHighMm={cropMm?.high} />
      {note !== undefined ? (
        <View style={[styles.note, { top: headerHeight + 8, backgroundColor: withAlpha("#000000", 0.45) }]} pointerEvents="none">
          <Text style={styles.noteText} numberOfLines={2}>
            {note}
          </Text>
        </View>
      ) : null}
      {crop !== undefined && best !== undefined && layerCount > 1 ? (
        <View style={[styles.range, { top: headerHeight + 56, bottom: PEEK_HEIGHT + insets.bottom + 24 }]}>
          <LayerRange count={layerCount} range={crop} onChange={setCrop} color={palette.accent} labelColor={text.label} />
        </View>
      ) : null}

      <Host style={styles.host} ignoreSafeArea="all" pointerEvents="box-none">
        <BottomSheet isPresented={focused} onIsPresentedChange={() => undefined}>
          <Group
            modifiers={[
              presentationDetents([{ height: PEEK_HEIGHT }, "medium", "large"]),
              presentationDragIndicator("visible"),
              presentationBackgroundInteraction({ type: "enabledUpThrough", detent: "medium" }),
              interactiveDismissDisabled(),
            ]}
          >
            <Form>
              <Section>
                <VStack alignment="leading" spacing={4}>
                  <SwiftText modifiers={[font({ size: 22, weight: "bold" })]}>{title}</SwiftText>
                  {summary !== undefined ? <SwiftText modifiers={[secondaryText]}>{summary}</SwiftText> : null}
                </VStack>
                {onPrinter ? (
                  <Button
                    label={running === true ? "A print is running" : running === undefined ? "Checking the printer" : "Print"}
                    systemImage="printer"
                    onPress={print}
                    modifiers={[disabled(!canPrint)]}
                  />
                ) : null}
              </Section>
              <Section title="Model">
                <ColorPicker label="Colour" selection={color} onSelectionChange={(next) => setModelColor(next.slice(0, 7))} />
                <HStack spacing={14}>
                  {RESIN_SWATCHES.map((swatch) => (
                    <Button key={swatch.name} onPress={() => setModelColor(swatch.color)} modifiers={[buttonStyle("plain")]}>
                      <Image
                        systemName={color.toUpperCase() === swatch.color.toUpperCase() ? "checkmark.circle.fill" : "circle.fill"}
                        size={28}
                        modifiers={[foregroundStyle(swatch.color)]}
                      />
                    </Button>
                  ))}
                  <Spacer />
                </HStack>
                {custom ? <Button label="Use the theme's colour" onPress={() => setModelColor(undefined)} /> : null}
                <Toggle
                  label="Cut through the model"
                  systemImage="square.split.1x2"
                  isOn={crop !== undefined}
                  onIsOnChange={(on) => setCrop(on && layerCount > 0 ? { from: 1, to: layerCount } : undefined)}
                />
                {crop !== undefined ? (
                  <LabeledContent label="Layers">
                    <SwiftText modifiers={[secondaryText]}>{`${crop.from.toLocaleString()} to ${crop.to.toLocaleString()}`}</SwiftText>
                  </LabeledContent>
                ) : null}
                <LabeledContent label="Detail">
                  <SwiftText modifiers={[secondaryText]}>
                    {best === undefined ? "Not here yet" : `${bestLevel === "high" ? "Full" : "Quick view"} · ${best.triangleCount.toLocaleString()} triangles`}
                  </SwiftText>
                </LabeledContent>
              </Section>
              {header !== undefined ? (
                <Section title="Print settings">
                  {settingsCells(header).map((cell) => (
                    <LabeledContent key={cell.label} label={cell.label}>
                      <SwiftText modifiers={[secondaryText]}>{cell.value}</SwiftText>
                    </LabeledContent>
                  ))}
                </Section>
              ) : null}
            </Form>
          </Group>
        </BottomSheet>
      </Host>
    </View>
  );
};

const styles = StyleSheet.create({
  page: { flex: 1 },
  thumbnail: { position: "absolute", left: 24, right: 24 },
  note: { position: "absolute", alignSelf: "center", paddingHorizontal: 14, paddingVertical: 7, borderRadius: 16, maxWidth: "86%" },
  noteText: { color: "#FFFFFF", fontSize: 14, fontWeight: "600", textAlign: "center" },
  range: { position: "absolute", right: 14, width: 30 },
  // The sheet presents itself; the host only anchors it.
  host: { position: "absolute", width: 1, height: 1 },
});
