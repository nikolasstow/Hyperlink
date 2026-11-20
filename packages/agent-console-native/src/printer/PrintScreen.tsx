/**
 * The print page, from the print summary on the printer home: the File
 * card (what the file is, its name, its settings), the stage (the layer on
 * the LCD at its real size in millimetres, and the camera as a second page:
 * StagePager.tsx), the print's progress, pause, resume, and stop, the 3D
 * model, and how the file was made (FileOrigin.tsx).
 *
 * It uses the printer home's live link (printerPageLink.ts), so it opens
 * no connection of its own. Layer images come from the relay, which has
 * each print's layer index already; when the relay is unreachable on the
 * LAN, the phone decodes them from the printer.
 *
 * See docs/handoffs/elegoo-printer-plugin.md.
 *
 * @internal
 */
import { useIsFocused, useNavigation, type NavigationProp } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import * as React from "react";
import { Image, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { PrinterPip } from "../../modules/printer-pip";
import { authedSource } from "../auth/serverTokens";
import { useOpenTiming } from "../perfMonitor";
import type { RootStackParamList } from "../RootNavigator";
import { towardWhite, useTextColors, useScreenBackground } from "../theme";
import { useDirectLayer } from "./directLayers";
import { FileOrigin } from "./FileOrigin";
import { useLayerPack } from "./layerPack";
import { ModelCard } from "./ModelCard";
import { CameraPane } from "./PrinterCamera";
import { DEFAULT_LCD_MM, settingsCells } from "./printerFormat";
import { useMeasure, usePrinterPageLink } from "./printerPageLink";
import { Controls, Lcd, Progress, useLoadedUri } from "./PrinterStage";
import { usePrintHeader } from "./printHeader";
import { linkChip, statusOf } from "./printStatus";
import { cameraSocketUrl, printPreviewUrl } from "./relayApi";
import { useRelayToken } from "./relayToken";
import { originRoute, useCatalog } from "./resinApi";
import { describeFile } from "./resinFormat";
import { isPrinting, layerIndexOf, PHASE_COMPLETE, PHASE_EXPOSING, PHASE_PAUSED, phaseLabel, PRINTER_PORT } from "./sdcp";
import { StagePager } from "./StagePager";
import { Card, Cells, Chip, LCD, Note, usePalette } from "./ui";
import type { PrinterLink } from "./usePrinterLink";

type Props = NativeStackScreenProps<RootStackParamList, "ServerPrint">;

/** How long the grabber takes to glide back to live: longer for a longer way, within these bounds. */
const SWEEP_MIN_MS = 350;
const SWEEP_MAX_MS = 900;
const SWEEP_MS_PER_LAYER = 0.25;

/** The File card's preview, at a fixed size. */
const PREVIEW = 76;

export const PrintScreen = (props: Props): React.ReactElement => {
  useOpenTiming("ServerPrint");
  const background = useScreenBackground("grouped");
  const text = useTextColors();
  const insets = useSafeAreaInsets();
  const link = usePrinterPageLink(props.route.params.serverAddress);
  return (
    <View style={[styles.root, { backgroundColor: background }]}>
      {link === undefined ? (
        <>
          <Text style={[styles.gone, { color: text.tertiaryLabel, marginTop: 40, marginBottom: insets.bottom }]}>Open the printer page first.</Text>
        </>
      ) : (
        <PrintView printer={link} serverName={props.route.params.serverName} serverAddress={props.route.params.serverAddress} />
      )}
    </View>
  );
};

const PrintView = (props: { readonly printer: PrinterLink; readonly serverName: string; readonly serverAddress: string }): React.ReactElement => {
  const { printer } = props;
  const text = useTextColors();
  const palette = usePalette();
  const focused = useIsFocused();
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const relayToken = useRelayToken(printer.relayBase);
  const [measure] = useMeasure();
  // Re-render every second so times move between pushes.
  const [now, setNow] = React.useState(Date.now());
  React.useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const status = printer.status;
  const info = status?.PrintInfo;
  const online = printer.link.kind === "Open";
  const printing = isPrinting(status);
  const hasJob = info?.TaskId !== undefined && info.TaskId !== "" && info.Filename !== undefined && info.Filename !== "";
  const active = hasJob && printing;
  const exposing = active && info?.Status === PHASE_EXPOSING;
  const paused = active && info?.Status === PHASE_PAUSED;
  const total = info?.TotalLayer ?? 0;
  const current = info?.CurrentLayer ?? 0;
  const index = hasJob && total > 0 ? layerIndexOf(current, total) : undefined;
  const percent = total > 0 ? (current / total) * 100 : 0;
  // The layer the owner scrubbed to (1 to total); undefined while the LCD follows the printer. A new print starts live.
  const [scrub, setScrub] = React.useState<{ readonly taskId: string; readonly layer: number } | undefined>(undefined);
  const scrubLayer = hasJob && scrub !== undefined && scrub.taskId === info?.TaskId ? Math.min(scrub.layer, total) : undefined;
  const viewIndex = scrubLayer !== undefined ? layerIndexOf(scrubLayer, total) : index;
  // The layer under the finger while the owner drags the grabber.
  const [dragLayer, setDragLayer] = React.useState<number | undefined>(undefined);
  // The layer on screen while the grabber sweeps back to live.
  const [sweep, setSweep] = React.useState<number | undefined>(undefined);
  const sweepFrame = React.useRef<number | undefined>(undefined);
  const liveLayer = React.useRef(current);
  liveLayer.current = current;
  const stopSweep = React.useCallback((): void => {
    if (sweepFrame.current !== undefined) cancelAnimationFrame(sweepFrame.current);
    sweepFrame.current = undefined;
    setSweep(undefined);
  }, []);
  React.useEffect(() => stopSweep, [stopSweep]);
  const passing = dragLayer ?? sweep;
  // The LCD shows these layers from the pack on the phone, with no request.
  const dragIndex = hasJob && passing !== undefined && total > 0 ? layerIndexOf(Math.min(passing, total), total) : undefined;
  // Ticks only arrive with a push; between pushes, count on from the last one.
  const sincePush = active && !paused && printer.updatedAt !== undefined ? now - printer.updatedAt : 0;
  const remaining = info?.TotalTicks !== undefined && info.CurrentTicks !== undefined ? info.TotalTicks - info.CurrentTicks - sincePush : undefined;

  const { header, error: headerError } = usePrintHeader(printer.relayBase, hasJob ? info?.TaskId : undefined, printer.relayReachable);
  const origin = useCatalog(printer.relayBase, hasJob && info?.Filename !== undefined ? originRoute(info.Filename) : undefined);

  // Layer images: from the relay when it answers; decoded on the phone from the printer when only the printer does.
  const direct = printer.link.kind === "Open" && printer.link.via === "Direct" && printer.printerIp !== undefined;
  const decodeHere = direct && !printer.relayReachable;
  const printerBase = printer.printerIp === undefined ? undefined : `http://${printer.printerIp}:${PRINTER_PORT}`;
  // Decoded on the phone, the LCD and the Picture in Picture share the one layer: while scrubbed, the window shows it too.
  const directLayer = useDirectLayer(
    decodeHere && printerBase !== undefined && hasJob && info?.TaskId !== undefined && info.Filename !== undefined && viewIndex !== undefined
      ? { printerBase, filename: info.Filename, taskId: info.TaskId, index: viewIndex, totalLayers: total, mirror: false }
      : undefined,
  );
  const relayLayerAt = (at: number | undefined, scrubbed: boolean): string | undefined =>
    !decodeHere && printer.relayReachable && hasJob && info?.TaskId !== undefined && at !== undefined
      ? `${printer.relayBase}/api/prints/${encodeURIComponent(info.TaskId)}/layers/${at}.png?alpha=1&scale=8${scrubbed ? "&scrub=1" : ""}`
      : undefined;
  // Every layer, small, on the device: the LCD shows any layer at once while the full image loads.
  const pack = useLayerPack(!decodeHere && printer.relayReachable ? printer.relayBase : undefined, hasJob ? info?.TaskId : undefined);
  // The live layer feeds the Picture in Picture; the LCD shows the scrubbed one while there is one.
  const layerUri = useLoadedUri(decodeHere ? directLayer.uri : relayLayerAt(index, false));
  const wantedScrub = decodeHere || scrubLayer === undefined ? undefined : relayLayerAt(viewIndex, true);
  const scrubbedUri = useLoadedUri(wantedScrub);
  // A loaded full image is for the layer it names; until the one for this layer loads, the pack shows it.
  const stageUri = decodeHere
    ? layerUri
    : dragIndex !== undefined
      ? (pack.uriOf(dragIndex) ?? (scrubLayer === undefined ? layerUri : scrubbedUri))
      : scrubLayer === undefined
        ? (layerUri ?? pack.uriOf(index))
        : scrubbedUri === wantedScrub
          ? scrubbedUri
          : (pack.uriOf(viewIndex) ?? scrubbedUri);
  const previewUri = hasJob && info?.TaskId !== undefined ? (decodeHere ? directLayer.previewUri : printer.relayReachable ? printPreviewUrl(printer.relayBase, info.TaskId) : undefined) : undefined;
  const lcdMm = header !== undefined ? { width: header.displayWidthMm, height: header.displayHeightMm } : (directLayer.lcdMm ?? DEFAULT_LCD_MM);
  const layerHeight = header?.layerHeightMm;
  const lcdNote = !hasJob
    ? online
      ? "No print running"
      : "Waiting for the printer…"
    : decodeHere
      ? directLayer.progress !== undefined
        ? `Reading the layer index from the printer (once per print): ${directLayer.progress.indexed.toLocaleString()} of ${directLayer.progress.target.toLocaleString()}`
        : directLayer.error !== undefined
          ? `Could not read the layer: ${directLayer.error}`
          : "Reading the layer from the printer…"
      : printer.relayReachable
        ? pack.state?.kind === "Building"
          ? `Getting every layer ready for scrubbing: ${pack.state.done.toLocaleString()} of ${pack.state.total.toLocaleString()}`
          : pack.state?.kind === "Downloading"
            ? "Downloading every layer for scrubbing…"
            : "Loading the layer…"
        : "Layer images come from the relay, which is not reachable.";

  // Back to live: the grabber glides to the printer's layer, and the LCD shows each layer it passes.
  const sweepToLive = (from: number): void => {
    setScrub(undefined);
    const started = Date.now();
    const duration = Math.min(SWEEP_MAX_MS, SWEEP_MIN_MS + Math.abs(liveLayer.current - from) * SWEEP_MS_PER_LAYER);
    const frame = (): void => {
      const t = Math.min(1, (Date.now() - started) / duration);
      const eased = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
      if (t >= 1) {
        sweepFrame.current = undefined;
        setSweep(undefined);
        return;
      }
      setSweep(Math.round(from + (liveLayer.current - from) * eased));
      sweepFrame.current = requestAnimationFrame(frame);
    };
    frame();
  };

  const state = statusOf(status, online);
  const linkState = linkChip(printer.link);
  // A phone shows one column; an iPad has room for two.
  const wide = width >= 700;
  const mainWidth = wide ? Math.floor((width - 32 - 14) * 0.6) : width - 32;
  const lcdWidth = mainWidth - 32;
  const lcdHeight = lcdWidth * (lcdMm.height / lcdMm.width);

  const identity = hasJob && info?.Filename !== undefined ? describeFile(info.Filename, origin.value?.print) : undefined;

  const fileCard = (
    <Card>
      <View style={styles.fileTop}>
        <View style={styles.preview}>{previewUri !== undefined ? <Image source={authedSource(previewUri)} style={styles.previewImage} resizeMode="cover" /> : null}</View>
        <View style={styles.fileText}>
          <Text style={[styles.eyebrow, { color: text.tertiaryLabel }]}>{hasJob ? (paused ? "PAUSED" : active ? "NOW PRINTING" : "LAST PRINT") : "NO PRINT"}</Text>
          <Text style={[styles.fileTitle, { color: text.label }]} numberOfLines={1}>
            {identity?.title ?? (online ? "No print running" : status === undefined ? "Connecting…" : "Printer not reachable")}
          </Text>
          {identity?.detail !== undefined ? (
            <Text style={[styles.fileDetail, { color: palette.accentInk }]} numberOfLines={1}>
              {identity.detail}
            </Text>
          ) : null}
          {hasJob && info?.Filename !== undefined ? (
            <Text style={[styles.fileName, { color: text.tertiaryLabel }]} numberOfLines={1}>
              {info.Filename}
            </Text>
          ) : null}
          <View style={styles.chips}>
            <Chip tone={state.tone} label={state.label} />
            <Chip tone={linkState.tone} label={linkState.label} onPress={printer.reconnect} />
          </View>
        </View>
      </View>
      {header !== undefined ? <Cells cells={settingsCells(header)} compact /> : null}
      {header === undefined && headerError !== undefined ? <Note text={`The relay did not give the file's settings: ${headerError}`} tone="bad" /> : null}
    </Card>
  );

  const timeline = hasJob ? (
    <Progress
      width={lcdWidth}
      totalLayers={total}
      liveLayer={current}
      viewedLayer={sweep ?? scrubLayer}
      onScrub={(layer) => {
        stopSweep();
        if (layer !== undefined && info?.TaskId !== undefined) setScrub({ taskId: info.TaskId, layer });
        else if (scrubLayer !== undefined && pack.state?.kind === "Ready") sweepToLive(scrubLayer);
        else setScrub(undefined);
      }}
      onDrag={(layer) => {
        if (layer !== undefined) stopSweep();
        setDragLayer(layer);
      }}
      percent={percent}
      elapsedMs={info?.CurrentTicks === undefined ? undefined : info.CurrentTicks + sincePush}
      remainingMs={remaining}
      totalMs={info?.TotalTicks}
      active={active}
      paused={paused}
      complete={!active && info?.Status === PHASE_COMPLETE}
      finishAt={active && remaining !== undefined ? new Date(now + remaining) : undefined}
      zMm={layerHeight !== undefined ? current * layerHeight : undefined}
      heightMm={layerHeight !== undefined ? total * layerHeight : undefined}
      columns={wide ? 4 : 2}
    />
  ) : null;

  const stage = (
    <Card>
      <StagePager
        width={lcdWidth}
        height={lcdHeight}
        layer={
          <Lcd
            width={lcdWidth}
            lcdMm={lcdMm}
            uri={hasJob ? stageUri : undefined}
            exposing={exposing && scrubLayer === undefined && dragIndex === undefined}
            lit={scrubLayer !== undefined || dragIndex !== undefined}
            active={active || scrubLayer !== undefined || dragIndex !== undefined}
            layer={hasJob ? (scrubLayer ?? current) : undefined}
            phase={scrubLayer !== undefined ? `Layer ${scrubLayer.toLocaleString()}` : active ? phaseLabel(info?.Status) : undefined}
            measure={measure}
            note={lcdNote}
          />
        }
        camera={(visible) => <CameraPane relayBase={printer.relayBase} secureUrl={printer.secureUrl} reachable={printer.relayReachable} visible={visible && focused} width={lcdWidth} height={lcdHeight} />}
        behind={(page) => (
          // Leaving the app opens Picture in Picture of this page: the camera, or the layer while a print runs.
          <PrinterPip
            style={StyleSheet.absoluteFill}
            mode={page === "Camera" ? "camera" : "layer"}
            cameraUrl={printer.relayReachable ? cameraSocketUrl(printer.relayBase) : undefined}
            relayToken={relayToken}
            layerUri={hasJob ? layerUri : undefined}
            tint={towardWhite(palette.accent, 0.88)}
            aspect={lcdMm.width / lcdMm.height}
            phase={active ? phaseLabel(info?.Status) : undefined}
            exposing={exposing}
            active={active}
            glowColor={palette.accent}
            phaseColor={towardWhite(palette.accent, 0.7)}
            dotColor={palette.accentInk}
            percent={hasJob ? percent : undefined}
            elapsedMs={active && info?.CurrentTicks !== undefined ? info.CurrentTicks + sincePush : undefined}
            remainingMs={active ? remaining : undefined}
            enabled={focused && (page === "Camera" ? printer.relayReachable : hasJob)}
          />
        )}
      />
      {timeline}
      {active && online ? <Controls phase={info?.Status} send={printer.sendControl} /> : null}
    </Card>
  );

  // The model card: the 3D model needs the relay, which makes it from the print file.
  const modelCard =
    hasJob && printer.relayReachable && info?.TaskId !== undefined && info.Filename !== undefined ? <ModelCard relayBase={printer.relayBase} taskId={info.TaskId} filename={info.Filename} navigation={navigation} /> : null;

  const originCards = hasJob && info?.Filename !== undefined ? <FileOrigin relayBase={printer.relayBase} filename={info.Filename} serverName={props.serverName} serverAddress={props.serverAddress} /> : null;

  return (
    <>
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: insets.bottom + 40 }}>
        {wide ? (
          <View style={styles.columns}>
            <View style={{ width: mainWidth }}>
              {stage}
              {modelCard}
            </View>
            <View style={styles.side}>
              {fileCard}
              {originCards}
            </View>
          </View>
        ) : (
          <>
            {fileCard}
            {stage}
            {modelCard}
            {originCards}
          </>
        )}
        {printer.notice !== undefined ? <Text style={[styles.foot, { color: text.tertiaryLabel }]}>{printer.notice}</Text> : null}
      </ScrollView>
    </>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1 },
  gone: { fontSize: 13, textAlign: "center" },
  fileTop: { flexDirection: "row", gap: 12, marginBottom: 12 },
  preview: { width: PREVIEW, height: PREVIEW, borderRadius: 14, overflow: "hidden", backgroundColor: LCD },
  previewImage: { width: PREVIEW, height: PREVIEW },
  fileText: { flex: 1 },
  eyebrow: { fontSize: 10.5, fontWeight: "700", letterSpacing: 0.8 },
  fileTitle: { fontSize: 18, fontWeight: "700", letterSpacing: -0.3, marginTop: 2 },
  fileDetail: { fontSize: 13, fontWeight: "600", marginTop: 1 },
  fileName: { fontSize: 11.5, marginTop: 2 },
  chips: { flexDirection: "row", gap: 6, marginTop: 8 },
  foot: { fontSize: 11, textAlign: "center", marginTop: 6 },
  columns: { flexDirection: "row", gap: 14, alignItems: "flex-start" },
  side: { flex: 1 },
});
