/**
 * The resin printer page for a server: an Elegoo SDCP printer (Saturn 4
 * Ultra 16K) through that server's relay (saturn-uploader `relay`, port
 * 5197). It opens from the server's page, under Services, and works against
 * whichever server it was opened for.
 *
 * - Print: the stage (the layer on the LCD at its real size in millimetres,
 *   and the camera as a second page: StagePager.tsx), the print's progress,
 *   pause, resume, and stop, and the file's print settings.
 * - The 3D model: a card with the model's progress, then a button that
 *   opens it (printer/GooViewerScreen.tsx).
 * - Files (the shared explorer over the relay, with uploads from the phone),
 *   Health (the printer's vitals and self-check), and Settings: real pages
 *   (printer/PrinterPages.tsx), from the buttons at the top right of this
 *   page. Those pages have no such buttons; the back button returns here.
 *   They share this page's live link.
 *
 * Live status comes straight from the printer when the phone is on its LAN,
 * and through the relay otherwise (`printer/usePrinterLink.ts`). Layer images
 * come from the relay, which has each print's layer index already; when the
 * relay is unreachable on the LAN, the phone decodes them from the printer.
 *
 * The page sits on a blurred wash of the current print's slicer render, tinted
 * with the theme's colour while a layer exposes, and its cards are glass over
 * it. Every colour follows the user's theme (printer/ui.tsx `usePalette`).
 *
 * See docs/handoffs/elegoo-printer-plugin.md.
 *
 * @internal
 */
import { useHeaderHeight } from "@react-navigation/elements";
import { useIsFocused } from "@react-navigation/native";
import type { NativeStackHeaderItem, NativeStackScreenProps } from "@react-navigation/native-stack";
import * as React from "react";
import { ActivityIndicator, Image, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { SFSymbol } from "sf-symbols-typescript";
import { PrinterPip } from "../modules/printer-pip";
import { mark } from "./diagnostics/launchTrail";
import { HeaderTitlePill } from "./HeaderTitlePill";
import { Backdrop } from "./printer/Backdrop";
import { useDirectLayer } from "./printer/directLayers";
import { ModelCard } from "./printer/ModelCard";
import { authedSource } from "./auth/serverTokens";
import { CameraPane } from "./printer/PrinterCamera";
import { useRelayToken } from "./printer/relayToken";
import { useRunningUploads, useUploadWatch } from "./printer/PrinterFiles";
import { useLayerPack } from "./printer/layerPack";
import { useMeasure, usePublishPrinterLink } from "./printer/printerPageLink";
import { Controls, Lcd, Progress, useLoadedUri } from "./printer/PrinterStage";
import { DEFAULT_LCD_MM, healthItems, settingsCells } from "./printer/printerFormat";
import { cameraSocketUrl, fetchPrintHeader, printPreviewUrl, type PrintHeader } from "./printer/relayApi";
import { isPrinting, layerIndexOf, PHASE_COMPLETE, PHASE_EXPOSING, PHASE_PAUSED, PHASE_PAUSING, PHASE_STOPPED, PHASE_STOPPING, phaseLabel, PRINTER_PORT, printErrorLabel, type PrinterStatus } from "./printer/sdcp";
import { StagePager } from "./printer/StagePager";
import { Card, Cells, Chip, usePalette, type Tone } from "./printer/ui";
import { usePrinterLink, type LinkState } from "./printer/usePrinterLink";
import type { RootStackParamList } from "./RootNavigator";
import { towardWhite, useTextColors } from "./theme";

type Props = NativeStackScreenProps<RootStackParamList, "ServerPrinter">;

/** How long the grabber takes to glide back to live: longer for a longer way, within these bounds. */
const SWEEP_MIN_MS = 350;
const SWEEP_MAX_MS = 900;
const SWEEP_MS_PER_LAYER = 0.25;

const linkChip = (link: LinkState): { readonly label: string; readonly tone: Tone } => {
  switch (link.kind) {
    case "Open":
      return link.via === "Direct" ? { label: "Direct", tone: "ok" } : { label: "Relay", tone: "uv" };
    case "Connecting":
      return { label: "Connecting", tone: "warn" };
    case "Offline":
      return { label: "Offline", tone: "bad" };
  }
};

/** The print's state in a word, with its tone. */
const statusOf = (status: PrinterStatus | undefined, online: boolean): { readonly label: string; readonly tone: Tone } => {
  const info = status?.PrintInfo;
  const printing = isPrinting(status);
  if (!online) return { label: status === undefined ? "Connecting" : "Offline", tone: status === undefined ? "plain" : "bad" };
  if (info?.ErrorNumber !== undefined && info.ErrorNumber !== 0) return { label: printErrorLabel(info.ErrorNumber), tone: "bad" };
  if (info?.Filename === undefined || info.Filename === "") return { label: printing ? "Printing" : "Ready", tone: printing ? "uv" : "plain" };
  if (info.Status === PHASE_PAUSING) return { label: "Pausing", tone: "warn" };
  if (info.Status === PHASE_PAUSED) return { label: "Paused", tone: "warn" };
  if (info.Status === PHASE_STOPPING) return { label: "Stopping", tone: "warn" };
  if (printing) return { label: "Printing", tone: "uv" };
  if (info.Status === PHASE_COMPLETE) return { label: "Complete", tone: "ok" };
  if (info.Status === PHASE_STOPPED) return { label: "Stopped", tone: "plain" };
  return { label: "Ready", tone: "plain" };
};

/** The current print's header from the relay: the LCD's real size and the print settings. */
const usePrintHeader = (relayBase: string, taskId: string | undefined, reachable: boolean): PrintHeader | undefined => {
  const [header, setHeader] = React.useState<{ readonly taskId: string; readonly header: PrintHeader } | undefined>(undefined);
  React.useEffect(() => {
    if (taskId === undefined || !reachable || header?.taskId === taskId) return;
    let alive = true;
    void fetchPrintHeader(relayBase, taskId)
      .then((next) => {
        if (alive) setHeader({ taskId, header: next });
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [relayBase, taskId, reachable, header?.taskId]);
  return header?.taskId === taskId ? header?.header : undefined;
};

/** The pages this page opens, as buttons at the top right, in order. */
const PAGES: ReadonlyArray<{ readonly route: "ServerPrinterFiles" | "ServerPrinterHealth" | "ServerPrinterSettings"; readonly label: string; readonly icon: SFSymbol }> = [
  { route: "ServerPrinterFiles", label: "Files", icon: "folder" },
  { route: "ServerPrinterHealth", label: "Health", icon: "heart.text.square" },
  { route: "ServerPrinterSettings", label: "Settings", icon: "gearshape" },
];

export const PrinterScreen = (props: Props): React.ReactElement => {
  const text = useTextColors();
  const palette = usePalette();
  const focused = useIsFocused();
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const { width } = useWindowDimensions();
  const { navigation } = props;
  // `?.` guards a nav state restored before this screen took params.
  const serverAddress = props.route.params?.serverAddress;
  const printer = usePrinterLink(serverAddress);
  const relayToken = useRelayToken(printer.relayBase);
  usePublishPrinterLink(serverAddress, printer);
  const [measure] = useMeasure();
  const runningUploads = useRunningUploads();
  // The launch trail: the printer page is the suspect in a launch that dies.
  React.useEffect(() => {
    mark("printer page mounted");
    return () => mark("printer page unmounted");
  }, []);
  const linkStep = `printer link: ${printer.link.kind}${printer.link.kind === "Open" ? ` via ${printer.link.via}` : ""}`;
  React.useEffect(() => {
    mark(linkStep);
  }, [linkStep]);
  useUploadWatch(printer.relayBase, printer.relayReachable);
  // The spinner is for the first try only. After that the cards stay, so a page
  // that keeps retrying does not swap between the spinner and the cards.
  const [tried, setTried] = React.useState(false);
  if (!tried && printer.link.kind !== "Connecting") setTried(true);
  // Re-render every second so times move between pushes.
  const [now, setNow] = React.useState(Date.now());
  React.useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const status = printer.status;
  const attributes = printer.attributes;
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

  const header = usePrintHeader(printer.relayBase, hasJob ? info?.TaskId : undefined, printer.relayReachable);

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
  const link = linkChip(printer.link);
  // A phone shows one column; an iPad has room for two on the print.
  const wide = width >= 700;
  const mainWidth = wide ? Math.floor((width - 32 - 14) * 0.6) : width - 32;
  const lcdWidth = mainWidth - 32;
  const lcdHeight = lcdWidth * (lcdMm.height / lcdMm.width);
  const health = healthItems(attributes?.DevicesStatus);
  const healthBad = health.filter((item) => !item.ok).length;

  // The buttons at the top right open the pages, with what needs attention on each.
  const serverName = props.route.params?.serverName ?? "";
  React.useLayoutEffect(() => {
    navigation.setOptions({
      headerTitle: () => <HeaderTitlePill title="Printer" rightButtons={PAGES.length} />,
      unstable_headerRightItems: () =>
        PAGES.map((page): NativeStackHeaderItem => {
          const count = page.route === "ServerPrinterFiles" ? runningUploads : page.route === "ServerPrinterHealth" ? healthBad : 0;
          return {
            type: "button",
            label: page.label,
            accessibilityLabel: page.label,
            icon: { type: "sfSymbol", name: page.icon },
            ...(count > 0 ? { badge: { value: count } } : {}),
            onPress: () => navigation.navigate(page.route, { serverName, serverAddress: serverAddress ?? "" }),
          };
        }),
    });
  }, [navigation, runningUploads, healthBad, serverName, serverAddress]);

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

  const titleBlock = (
    <View style={styles.titleBlock}>
      <Text style={[styles.eyebrow, { color: text.tertiaryLabel }]}>{hasJob ? (paused ? "PAUSED" : active ? "NOW PRINTING" : "LAST PRINT") : (attributes?.Name ?? "RESIN PRINTER").toUpperCase()}</Text>
      <Text style={[styles.title, { color: text.label }]} numberOfLines={2}>
        {hasJob && info?.Filename !== undefined ? info.Filename.replace(/\.(goo|ctb)$/i, "") : online ? "No print running" : status === undefined ? "Connecting…" : "Printer not reachable"}
      </Text>
      {hasJob ? (
        <Text style={[styles.meta, { color: text.secondaryLabel }]}>
          Layer {current.toLocaleString()} of {total.toLocaleString()}
        </Text>
      ) : null}
      <View style={styles.chips}>
        <Chip tone={state.tone} label={state.label} />
        <Chip tone={link.tone} label={link.label} onPress={printer.reconnect} />
      </View>
    </View>
  );

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

  const printSettings =
    header !== undefined ? (
      <Card title="Print settings">
        {previewUri !== undefined ? (
          <View style={styles.preview}>
            <Image source={authedSource(previewUri)} style={StyleSheet.absoluteFill} resizeMode="cover" />
          </View>
        ) : null}
        <Cells cells={settingsCells(header)} />
      </Card>
    ) : null;

  const connection = online ? (printer.link.kind === "Open" && printer.link.via === "Direct" ? `Direct to the printer at ${printer.printerIp ?? "its address"}` : `Through the relay on ${props.route.params?.serverName ?? "the server"}`) : "Not connected";

  // The model card: the 3D model needs the relay, which makes it from the print file.
  const modelCard =
    hasJob && printer.relayReachable && info?.TaskId !== undefined && info.Filename !== undefined ? (
      <ModelCard relayBase={printer.relayBase} taskId={info.TaskId} filename={info.Filename} navigation={navigation} />
    ) : null;

  const footer = (
    <>
      {printer.notice !== undefined ? <Text style={[styles.foot, { color: text.tertiaryLabel }]}>{printer.notice}</Text> : null}
      <Text style={[styles.foot, { color: text.tertiaryLabel }]}>
        {connection}
        {printer.updatedAt !== undefined ? ` · updated ${new Date(printer.updatedAt).toLocaleTimeString()}` : ""}
      </Text>
    </>
  );

  const printView = wide ? (
    <View style={styles.columns}>
      <View style={{ width: mainWidth }}>{stage}</View>
      <View style={styles.side}>
        {modelCard}
        {printSettings}
      </View>
    </View>
  ) : (
    <>
      {stage}
      {modelCard}
      {printSettings}
    </>
  );

  return (
    <View style={styles.root}>
      <Backdrop uri={previewUri} glow={exposing ? 1 : active ? 0.45 : 0} />
      <ScrollView contentInsetAdjustmentBehavior="never" contentContainerStyle={{ paddingHorizontal: 16, paddingTop: headerHeight + 10, paddingBottom: insets.bottom + 40 }}>
        {titleBlock}
        {status === undefined && !tried ? (
          <ActivityIndicator style={styles.loading} />
        ) : (
          <View>
            {printView}
            {footer}
          </View>
        )}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1 },
  titleBlock: { marginBottom: 16, paddingHorizontal: 2 },
  eyebrow: { fontSize: 11, fontWeight: "700", letterSpacing: 0.9 },
  title: { fontSize: 28, fontWeight: "700", letterSpacing: -0.6, marginTop: 4 },
  meta: { fontSize: 14, marginTop: 4, fontVariant: ["tabular-nums"] },
  chips: { flexDirection: "row", gap: 8, marginTop: 12 },
  loading: { paddingVertical: 60 },
  faint: { fontSize: 12 },
  meter: { paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "rgba(127,127,127,0.3)" },
  meterTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 },
  meterLabel: { fontSize: 15 },
  meterValue: { fontSize: 15, fontWeight: "600", fontVariant: ["tabular-nums"] },
  meterTrack: { height: 5, borderRadius: 3, backgroundColor: "rgba(127,127,127,0.2)", overflow: "hidden" },
  meterFill: { height: 5, borderRadius: 3 },
  meterNote: { fontSize: 12, marginTop: 7 },
  health: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  healthItem: { width: "48.5%", flexGrow: 1, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 11, paddingVertical: 10, borderRadius: 12, backgroundColor: "rgba(127,127,127,0.1)" },
  healthText: { fontSize: 13, flexShrink: 1 },
  preview: { alignSelf: "center", width: 180, height: 180, borderRadius: 16, overflow: "hidden", backgroundColor: "#050508", marginBottom: 12 },
  foot: { fontSize: 11, textAlign: "center", marginTop: 6 },
  columns: { flexDirection: "row", gap: 14, alignItems: "flex-start" },
  side: { flex: 1 },
  switchRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  switchText: { flex: 1 },
  switchLabel: { fontSize: 15 },
  switchNote: { fontSize: 12, marginTop: 3 },
});
