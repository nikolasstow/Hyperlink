/**
 * The resin printer page for a server: an Elegoo SDCP printer (Saturn 4
 * Ultra 16K) through that server's relay (saturn-uploader `relay`, port
 * 5197). It opens from the server's page, under Services, and works against
 * whichever server it was opened for.
 *
 * - The stage: the layer on the LCD now, at the LCD's real size in
 *   millimetres, the print's progress, and pause, resume, and stop.
 * - The camera, files (with uploads from the phone), the printer's vitals,
 *   its self-check, and the current file's print settings.
 *
 * Live status comes straight from the printer when the phone is on its LAN,
 * and through the relay otherwise (`printer/usePrinterLink.ts`). Layer images
 * come from the relay, which has each print's layer index already; when the
 * relay is unreachable on the LAN, the phone decodes them from the printer.
 *
 * The page sits on a blurred wash of the current print's slicer render, tinted
 * UV while a layer exposes, and its cards are glass over it.
 *
 * See docs/handoffs/elegoo-printer-plugin.md.
 *
 * @internal
 */
import { useHeaderHeight } from "@react-navigation/elements";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { LinearGradient } from "expo-linear-gradient";
import * as React from "react";
import { ActivityIndicator, Animated, Image, ScrollView, StyleSheet, Text, useColorScheme, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Defs, RadialGradient, Rect, Stop } from "react-native-svg";
import { useDirectLayer } from "./printer/directLayers";
import { PrinterCamera } from "./printer/PrinterCamera";
import { PrinterFiles } from "./printer/PrinterFiles";
import { Controls, Lcd, Progress, useLoadedUri } from "./printer/PrinterStage";
import { DEFAULT_LCD_MM, fmtBytes, healthItems, settingsCells } from "./printer/printerFormat";
import { fetchPrintHeader, printPreviewUrl, type PrintHeader } from "./printer/relayApi";
import { isPrinting, layerIndexOf, PHASE_COMPLETE, PHASE_EXPOSING, PHASE_PAUSED, PHASE_PAUSING, PHASE_STOPPED, PHASE_STOPPING, phaseLabel, PRINTER_PORT, printErrorLabel, type PrinterStatus } from "./printer/sdcp";
import { Card, Cells, Chip, Dot, Row, type Tone } from "./printer/ui";
import { usePrinterLink, type LinkState } from "./printer/usePrinterLink";
import type { RootStackParamList } from "./RootNavigator";
import { useScreenBackground, useTextColors } from "./theme";

type Props = NativeStackScreenProps<RootStackParamList, "ServerPrinter">;

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

/** The page's backdrop: the print's slicer render, blurred and darkened, with a UV wash while the printer exposes. */
const Backdrop = (props: { readonly uri: string | undefined; readonly glow: number }): React.ReactElement => {
  const background = useScreenBackground("grouped");
  const dark = useColorScheme() === "dark";
  const { width, height } = useWindowDimensions();
  const glow = React.useRef(new Animated.Value(props.glow)).current;
  React.useEffect(() => {
    Animated.timing(glow, { toValue: props.glow, duration: 900, useNativeDriver: true }).start();
  }, [glow, props.glow]);
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: background }]} pointerEvents="none">
      {props.uri !== undefined ? <Image source={{ uri: props.uri }} style={[StyleSheet.absoluteFill, { opacity: dark ? 0.55 : 0.4 }]} resizeMode="cover" blurRadius={60} /> : null}
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: glow }]}>
        <Svg width={width} height={height}>
          <Defs>
            <RadialGradient id="uv" cx="30%" cy="22%" r="70%">
              <Stop offset="0" stopColor="#8f73ff" stopOpacity={0.55} />
              <Stop offset="1" stopColor="#8f73ff" stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Rect x={0} y={0} width={width} height={height} fill="url(#uv)" />
        </Svg>
      </Animated.View>
      <LinearGradient
        colors={dark ? ["rgba(6,7,11,0.35)", "rgba(6,7,11,0.82)"] : ["rgba(240,242,248,0.25)", "rgba(240,242,248,0.8)"]}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
};

export const PrinterScreen = (props: Props): React.ReactElement => {
  const text = useTextColors();
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const { width } = useWindowDimensions();
  // `?.` guards a nav state restored before this screen took params.
  const serverAddress = props.route.params?.serverAddress;
  const printer = usePrinterLink(serverAddress);
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
  // Ticks only arrive with a push; between pushes, count on from the last one.
  const sincePush = active && !paused && printer.updatedAt !== undefined ? now - printer.updatedAt : 0;
  const remaining = info?.TotalTicks !== undefined && info.CurrentTicks !== undefined ? info.TotalTicks - info.CurrentTicks - sincePush : undefined;

  const header = usePrintHeader(printer.relayBase, hasJob ? info?.TaskId : undefined, printer.relayReachable);

  // Layer images: from the relay when it answers; decoded on the phone from the printer when only the printer does.
  const direct = printer.link.kind === "Open" && printer.link.via === "Direct" && printer.printerIp !== undefined;
  const decodeHere = direct && !printer.relayReachable;
  const printerBase = printer.printerIp === undefined ? undefined : `http://${printer.printerIp}:${PRINTER_PORT}`;
  const directLayer = useDirectLayer(
    decodeHere && printerBase !== undefined && hasJob && info?.TaskId !== undefined && info.Filename !== undefined && index !== undefined
      ? { printerBase, filename: info.Filename, taskId: info.TaskId, index, totalLayers: total, mirror: false }
      : undefined,
  );
  const relayLayer = !decodeHere && printer.relayReachable && hasJob && info?.TaskId !== undefined && index !== undefined ? `${printer.relayBase}/api/prints/${encodeURIComponent(info.TaskId)}/layers/${index}.png?alpha=1&scale=8` : undefined;
  const layerUri = useLoadedUri(decodeHere ? directLayer.uri : relayLayer);
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
        ? "Loading the layer…"
        : "Layer images come from the relay, which is not reachable.";

  const state = statusOf(status, online);
  const link = linkChip(printer.link);
  const cardInner = width - 32 - 32;
  const film = status?.ReleaseFilm;
  const filmMax = attributes?.ReleaseFilmMax;
  const filmRatio = film !== undefined && filmMax !== undefined && filmMax > 0 ? film / filmMax : undefined;
  const health = healthItems(attributes?.DevicesStatus);
  const healthBad = health.filter((item) => !item.ok).length;

  return (
    <View style={styles.root}>
      <Backdrop uri={previewUri} glow={exposing ? 1 : active ? 0.45 : 0} />
      <ScrollView contentInsetAdjustmentBehavior="never" contentContainerStyle={{ paddingHorizontal: 16, paddingTop: headerHeight + 10, paddingBottom: insets.bottom + 40 }}>
        <View style={styles.titleBlock}>
          <Text style={[styles.eyebrow, { color: text.tertiaryLabel }]}>{hasJob ? (paused ? "PAUSED" : active ? "NOW PRINTING" : "LAST PRINT") : (attributes?.Name ?? "RESIN PRINTER").toUpperCase()}</Text>
          <Text style={[styles.title, { color: text.label }]} numberOfLines={2}>
            {hasJob && info?.Filename !== undefined ? info.Filename.replace(/\.(goo|ctb)$/i, "") : online ? "No print running" : status === undefined ? "Connecting…" : "Printer not reachable"}
          </Text>
          {hasJob ? (
            <Text style={[styles.meta, { color: text.secondaryLabel }]}>
              Layer {current.toLocaleString()} of {total.toLocaleString()}
              {layerHeight !== undefined ? ` · Z ${(current * layerHeight).toFixed(2)} of ${(total * layerHeight).toFixed(2)} mm` : ""}
            </Text>
          ) : null}
          <View style={styles.chips}>
            <Chip tone={state.tone} label={state.label} />
            <Chip tone={link.tone} label={link.label} onPress={printer.reconnect} />
          </View>
        </View>

        {status === undefined && !tried ? (
          <ActivityIndicator style={styles.loading} />
        ) : (
          <>
            <Card>
              <Lcd width={cardInner} lcdMm={lcdMm} uri={hasJob ? layerUri : undefined} exposing={exposing} active={active} layer={hasJob ? current : undefined} phase={active ? phaseLabel(info?.Status) : undefined} zMm={hasJob && layerHeight !== undefined ? current * layerHeight : undefined} note={lcdNote} />
              {hasJob ? (
                <Progress
                  percent={percent}
                  elapsedMs={info?.CurrentTicks === undefined ? undefined : info.CurrentTicks + sincePush}
                  remainingMs={remaining}
                  totalMs={info?.TotalTicks}
                  active={active}
                  paused={paused}
                  complete={!active && info?.Status === PHASE_COMPLETE}
                  finishAt={active && remaining !== undefined ? new Date(now + remaining) : undefined}
                />
              ) : null}
              {active && online ? <Controls phase={info?.Status} send={printer.sendControl} /> : null}
            </Card>

            <PrinterCamera relayBase={printer.relayBase} secureUrl={printer.secureUrl} reachable={printer.relayReachable} />

            <PrinterFiles relayBase={printer.relayBase} reachable={printer.relayReachable} printingName={active ? info?.Filename : undefined} usbIn={attributes?.UsbDiskStatus === 1} />

            <Card title="Printer" right={attributes?.FirmwareVersion !== undefined ? <Text style={[styles.faint, { color: text.tertiaryLabel }]}>Firmware {attributes.FirmwareVersion}</Text> : undefined}>
              {film !== undefined && filmMax !== undefined && filmRatio !== undefined ? (
                <View style={styles.meter}>
                  <View style={styles.meterTop}>
                    <Text style={[styles.meterLabel, { color: text.secondaryLabel }]}>Release film</Text>
                    <Text style={[styles.meterValue, { color: text.label }]}>
                      {film.toLocaleString()} / {filmMax.toLocaleString()}
                    </Text>
                  </View>
                  <View style={styles.meterTrack}>
                    <View style={[styles.meterFill, { width: `${Math.min(100, filmRatio * 100)}%`, backgroundColor: filmRatio >= 1 ? "#ff5a5f" : filmRatio >= 0.85 ? "#ffb547" : "#32d07c" }]} />
                  </View>
                  {filmRatio >= 0.85 ? <Text style={[styles.meterNote, { color: filmRatio >= 1 ? "#ff5a5f" : text.tertiaryLabel }]}>{filmRatio >= 1 ? "Past its rated number of cycles. Replace the film soon." : "Nearing its rated number of cycles."}</Text> : null}
                </View>
              ) : null}
              <Row label="UV LED" value={status?.TempOfUVLED !== undefined ? `${status.TempOfUVLED.toFixed(1)} °C` : "—"} />
              <Row label="Resin" value={status?.TempOfTank !== undefined ? `${status.TempOfTank} °C${status.TempTargetTank ? ` · target ${status.TempTargetTank} °C` : ""}` : "—"} />
              <Row label="Storage free" value={attributes?.RemainingMemory !== undefined ? fmtBytes(attributes.RemainingMemory) : "—"} />
              <Row label="Network" value={`${attributes?.NetworkStatus === "eth" ? "Ethernet" : attributes?.NetworkStatus === "wlan" ? "Wi-Fi" : "—"}${attributes?.UsbDiskStatus === 1 ? " · USB drive in" : ""}`} />
              <Row label="Address" value={printer.printerIp ?? "—"} last />
            </Card>

            {health.length > 0 ? (
              <Card title="Self-check" right={<Text style={[styles.faint, { color: healthBad > 0 ? "#ff5a5f" : text.tertiaryLabel }]}>{healthBad === 0 ? "All normal" : `${healthBad} to check`}</Text>}>
                <View style={styles.health}>
                  {health.map((item) => (
                    <View key={item.label} style={[styles.healthItem, item.ok ? null : styles.healthBad]}>
                      <Dot tone={item.ok ? "ok" : "bad"} size={7} />
                      <Text style={[styles.healthText, { color: text.label }]} numberOfLines={1}>
                        {item.label}
                      </Text>
                    </View>
                  ))}
                </View>
              </Card>
            ) : null}

            {header !== undefined ? (
              <Card title="Print settings">
                {previewUri !== undefined ? (
                  <View style={styles.preview}>
                    <Image source={{ uri: previewUri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                  </View>
                ) : null}
                <Cells cells={settingsCells(header)} />
              </Card>
            ) : null}

            {printer.notice !== undefined ? <Text style={[styles.foot, { color: text.tertiaryLabel }]}>{printer.notice}</Text> : null}
            <Text style={[styles.foot, { color: text.tertiaryLabel }]}>
              {online ? (printer.link.kind === "Open" && printer.link.via === "Direct" ? `Direct to the printer at ${printer.printerIp ?? "its address"}` : `Through the relay on ${props.route.params?.serverName ?? "the server"}`) : "Not connected"}
              {printer.updatedAt !== undefined ? ` · updated ${new Date(printer.updatedAt).toLocaleTimeString()}` : ""}
            </Text>
          </>
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
  healthBad: { backgroundColor: "rgba(255,90,95,0.14)" },
  healthText: { fontSize: 13, flexShrink: 1 },
  preview: { alignSelf: "center", width: 180, height: 180, borderRadius: 16, overflow: "hidden", backgroundColor: "#050508", marginBottom: 12 },
  foot: { fontSize: 11, textAlign: "center", marginTop: 6 },
});
